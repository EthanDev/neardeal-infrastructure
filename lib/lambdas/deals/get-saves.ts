import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const userId = event.requestContext.authorizer.jwt.claims.sub as string;
    if (!userId) return respond(401, { message: 'Unauthorized' });

    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '20', 10), 50);
    const nextToken = params.nextToken;

    // Query saved deals via GSI1
    const queryParams: Record<string, unknown> = {
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}#SAVES` },
      ScanIndexForward: false,
      Limit: limit,
    };

    if (nextToken) {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64url').toString());
    }

    const result = await ddb.send(new QueryCommand(queryParams as any));
    const saveItems = result.Items || [];

    if (saveItems.length === 0) {
      return respond(200, { saves: [], count: 0, nextToken: null });
    }

    // Batch get full deal details
    const dealIds = saveItems.map((s) => s.dealId as string);
    const batchRes = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: dealIds.map((id) => ({ PK: `DEAL#${id}`, SK: 'META' })),
        },
      },
    }));
    const dealMap = new Map<string, Record<string, unknown>>();
    for (const item of batchRes.Responses?.[TABLE_NAME] || []) {
      dealMap.set(item.dealId as string, item);
    }

    const saves = saveItems.map((s) => {
      const deal = dealMap.get(s.dealId as string);
      if (!deal) return { dealId: s.dealId, savedAt: s.savedAt, deal: null };
      const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...safeDeal } = deal;
      return { dealId: s.dealId, savedAt: s.savedAt, deal: safeDeal };
    });

    const encodedNextToken = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
      : null;

    return respond(200, { saves, count: saves.length, nextToken: encodedNextToken });
  } catch (err) {
    console.error('getSaves error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

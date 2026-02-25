import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

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

    const dealId = event.pathParameters?.dealId;
    if (!dealId) return respond(400, { message: 'dealId is required' });

    // Verify deal exists
    const dealRes = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `DEAL#${dealId}`, SK: 'META' },
      ProjectionExpression: 'dealId, title',
    }));
    if (!dealRes.Item) return respond(404, { message: 'Deal not found' });

    // Check if already saved
    const saveKey = { PK: `USER#${userId}`, SK: `SAVE#${dealId}` };
    const existing = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: saveKey }));

    if (existing.Item) {
      // Unsave
      await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: saveKey }));
      return respond(200, { saved: false, message: 'Deal unsaved' });
    } else {
      // Save
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...saveKey,
          GSI1PK: `USER#${userId}#SAVES`,
          GSI1SK: new Date().toISOString(),
          dealId,
          dealTitle: dealRes.Item.title,
          savedAt: new Date().toISOString(),
        },
      }));
      return respond(200, { saved: true, message: 'Deal saved' });
    }
  } catch (err) {
    console.error('toggleSave error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

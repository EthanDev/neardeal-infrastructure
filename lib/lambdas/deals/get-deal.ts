import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import Redis from 'ioredis';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const REDIS_HOST = process.env.REDIS_HOST!;
const REDIS_PORT = process.env.REDIS_PORT!;

let redis: Redis | null = null;
const getRedis = () => {
  if (!redis) redis = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT), lazyConnect: true });
  return redis;
};

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

    const r = getRedis();

    // Try cache
    const cached = await r.get(`deal:${dealId}`);
    if (cached) {
      const deal = JSON.parse(cached);
      // Check if user has saved this deal
      const savedRes = await ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `SAVE#${dealId}` },
      }));
      deal.isSaved = !!savedRes.Item;

      // Check if user has claimed this deal
      const claimRes = await ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': `CLAIM#${userId}`,
        },
        Limit: 1,
      }));
      deal.hasClaimed = (claimRes.Items?.length || 0) > 0;

      const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...safe } = deal;
      return respond(200, safe);
    }

    // Fetch from DynamoDB
    const result = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `DEAL#${dealId}`, SK: 'META' },
    }));

    if (!result.Item) return respond(404, { message: 'Deal not found' });

    const deal = result.Item;

    // Cache it
    await r.set(`deal:${dealId}`, JSON.stringify(deal), 'EX', 3600);

    // Check saved/claimed status
    const [savedRes, claimRes] = await Promise.all([
      ddb.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `USER#${userId}`, SK: `SAVE#${dealId}` },
      })),
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': `CLAIM#${userId}`,
        },
        Limit: 1,
      })),
    ]);

    deal.isSaved = !!savedRes.Item;
    deal.hasClaimed = (claimRes.Items?.length || 0) > 0;

    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...safe } = deal;
    return respond(200, safe);
  } catch (err) {
    console.error('getDeal error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

    const params = event.queryStringParameters || {};
    const city = params.city || 'bucharest';

    const r = getRedis();

    // Scan flash keys for the city
    const flashKeys = await r.keys(`flash:${city}:*`);
    if (flashKeys.length > 0) {
      const pipeline = r.pipeline();
      for (const key of flashKeys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();
      const flashDeals = (results || [])
        .map(([err, val]) => (val ? JSON.parse(val as string) : null))
        .filter(Boolean)
        .filter((d: { flashExpiresAt: string }) => new Date(d.flashExpiresAt) > new Date());

      if (flashDeals.length > 0) {
        return respond(200, { deals: flashDeals, count: flashDeals.length, source: 'cache' });
      }
    }

    // Fallback: query DynamoDB for active flash deals
    const now = new Date().toISOString();
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :now',
      FilterExpression: 'isFlash = :isFlash AND #st = :status AND city = :city',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':pk': 'DEALS#ACTIVE',
        ':now': now,
        ':isFlash': true,
        ':status': 'active',
        ':city': city,
      },
      Limit: 10,
    }));

    const deals = (result.Items || []).map(({ PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...rest }) => rest);

    return respond(200, { deals, count: deals.length, source: 'dynamodb' });
  } catch (err) {
    console.error('getFlashDeal error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

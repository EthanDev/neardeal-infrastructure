import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const params = event.queryStringParameters || {};
    const city = params.city || 'bucharest';

    const r = getRedis();

    // Get cached stats
    const cachedStats = await r.get(`stats:city:${city}`);
    if (cachedStats) {
      return respond(200, JSON.parse(cachedStats));
    }

    // Compute from Redis counters and DynamoDB
    const [totalDeals, totalClaims, totalRedemptions] = await Promise.all([
      r.get(`stats:deals:${city}`),
      r.get(`stats:claims:${city}`),
      r.get(`stats:redemptions:${city}`),
    ]);

    // Count active deals from DynamoDB
    const now = new Date().toISOString();
    const activeDealsRes = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :now',
      FilterExpression: 'city = :city AND #st = :status',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':pk': 'DEALS#ACTIVE',
        ':now': now,
        ':city': city,
        ':status': 'active',
      },
      Select: 'COUNT',
    }));

    // Count active deals in geo set
    const geoCount = await r.zcard(`geo:deals:${city}`);

    const stats = {
      city,
      totalDealsCreated: parseInt(totalDeals || '0', 10),
      totalClaims: parseInt(totalClaims || '0', 10),
      totalRedemptions: parseInt(totalRedemptions || '0', 10),
      activeDeals: activeDealsRes.Count || 0,
      geoIndexedDeals: geoCount,
      updatedAt: new Date().toISOString(),
    };

    // Cache for 5 minutes
    await r.set(`stats:city:${city}`, JSON.stringify(stats), 'EX', 300);

    return respond(200, stats);
  } catch (err) {
    console.error('getCityStats error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

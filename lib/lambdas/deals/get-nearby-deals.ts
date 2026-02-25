import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
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
    const lat = parseFloat(params.lat || '');
    const lng = parseFloat(params.lng || '');
    const radius = parseFloat(params.radius || '5'); // km
    const city = params.city || 'bucharest';
    const category = params.category;
    const limit = Math.min(parseInt(params.limit || '20', 10), 50);

    if (isNaN(lat) || isNaN(lng)) {
      return respond(400, { message: 'lat and lng query parameters are required' });
    }

    const r = getRedis();

    // GEORADIUS returns deal IDs within radius
    const dealIds = await r.georadius(
      `geo:deals:${city}`,
      lng,
      lat,
      radius,
      'km',
      'WITHDIST',
      'ASC',
      'COUNT',
      limit * 2, // fetch extra to account for filtering
    );

    if (!dealIds || dealIds.length === 0) {
      return respond(200, { deals: [], count: 0 });
    }

    // Each result is [dealId, distance]
    const idsWithDist: Array<{ dealId: string; distance: number }> = [];
    for (let i = 0; i < dealIds.length; i += 2) {
      idsWithDist.push({ dealId: dealIds[i] as string, distance: parseFloat(dealIds[i + 1] as string) });
    }

    // Try cache first, fallback to DynamoDB
    const deals: Array<Record<string, unknown>> = [];
    const cacheMisses: string[] = [];

    const pipeline = r.pipeline();
    for (const { dealId } of idsWithDist) {
      pipeline.get(`deal:${dealId}`);
    }
    const cacheResults = await pipeline.exec();

    for (let i = 0; i < idsWithDist.length; i++) {
      const cached = cacheResults?.[i]?.[1] as string | null;
      if (cached) {
        const deal = JSON.parse(cached);
        deal._distance = idsWithDist[i].distance;
        deals.push(deal);
      } else {
        cacheMisses.push(idsWithDist[i].dealId);
      }
    }

    // Fetch cache misses from DynamoDB
    if (cacheMisses.length > 0) {
      const batchSize = 25;
      for (let i = 0; i < cacheMisses.length; i += batchSize) {
        const batch = cacheMisses.slice(i, i + batchSize);
        const res = await ddb.send(new BatchGetCommand({
          RequestItems: {
            [TABLE_NAME]: {
              Keys: batch.map((id) => ({ PK: `DEAL#${id}`, SK: 'META' })),
            },
          },
        }));
        const items = res.Responses?.[TABLE_NAME] || [];
        for (const item of items) {
          // Cache for next time
          await r.set(`deal:${item.dealId}`, JSON.stringify(item), 'EX', 3600);
          const matchIdx = idsWithDist.findIndex((d) => d.dealId === item.dealId);
          if (matchIdx >= 0) item._distance = idsWithDist[matchIdx].distance;
          deals.push(item);
        }
      }
    }

    // Filter: only active deals that haven't expired
    const now = new Date().toISOString();
    let filtered = deals.filter((d) => d.status === 'active' && d.expiresAt > now && (d.claimCount as number) < (d.maxClaims as number));

    // Category filter
    if (category) {
      filtered = filtered.filter((d) => d.category === category);
    }

    // Sort by distance
    filtered.sort((a, b) => (a._distance as number) - (b._distance as number));
    const result = filtered.slice(0, limit);

    // Strip internal fields
    const output = result.map(({ PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, _distance, ...rest }) => ({
      ...rest,
      distance: _distance,
    }));

    return respond(200, { deals: output, count: output.length });
  } catch (err) {
    console.error('getNearbyDeals error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

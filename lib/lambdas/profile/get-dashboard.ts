import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
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
    const businessId = event.requestContext.authorizer.jwt.claims.sub as string;
    if (!businessId) return respond(401, { message: 'Unauthorized' });

    // Get business profile
    const profileRes = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
    }));
    const profile = profileRes.Item;
    if (!profile) return respond(404, { message: 'Business profile not found' });

    // Get active deals
    const dealsRes = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `BIZ#${businessId}` },
      ScanIndexForward: false,
      Limit: 50,
    }));
    const deals = dealsRes.Items || [];

    const now = new Date().toISOString();
    const activeDeals = deals.filter((d) => d.status === 'active' && d.expiresAt > now);
    const expiredDeals = deals.filter((d) => d.status !== 'active' || d.expiresAt <= now);

    // Get redemption count from Redis
    const r = getRedis();
    const totalRedemptions = parseInt((await r.get(`biz:${businessId}:redemptions`)) || '0', 10);

    // Calculate total claim count and revenue
    let totalClaims = 0;
    let totalRevenue = 0;
    for (const deal of deals) {
      totalClaims += deal.claimCount || 0;
      totalRevenue += (deal.claimCount || 0) * (deal.discountedPrice || 0);
    }

    return respond(200, {
      businessName: profile.businessName,
      planTier: profile.planTier,
      activeDeals: activeDeals.length,
      expiredDeals: expiredDeals.length,
      totalDeals: deals.length,
      totalClaims,
      totalRedemptions,
      totalRevenue,
      recentDeals: activeDeals.slice(0, 10).map(({ PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...rest }) => rest),
    });
  } catch (err) {
    console.error('getDashboard error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

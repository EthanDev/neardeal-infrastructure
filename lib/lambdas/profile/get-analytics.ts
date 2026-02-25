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
    const businessId = event.requestContext.authorizer.jwt.claims.sub as string;
    if (!businessId) return respond(401, { message: 'Unauthorized' });

    const params = event.queryStringParameters || {};
    const period = params.period || '30d'; // 7d, 30d, 90d
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const days = daysMap[period] || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get all deals for this business in the period
    const dealsRes = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :start',
      ExpressionAttributeValues: {
        ':pk': `BIZ#${businessId}`,
        ':start': `DEAL#${startDate}`,
      },
      ScanIndexForward: false,
    }));
    const deals = dealsRes.Items || [];

    // Aggregate by category
    const categoryBreakdown: Record<string, { deals: number; claims: number; revenue: number }> = {};
    let totalClaims = 0;
    let totalRevenue = 0;

    for (const deal of deals) {
      const cat = deal.category || 'uncategorized';
      if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { deals: 0, claims: 0, revenue: 0 };
      categoryBreakdown[cat].deals += 1;
      categoryBreakdown[cat].claims += deal.claimCount || 0;
      categoryBreakdown[cat].revenue += (deal.claimCount || 0) * (deal.discountedPrice || 0);
      totalClaims += deal.claimCount || 0;
      totalRevenue += (deal.claimCount || 0) * (deal.discountedPrice || 0);
    }

    // Aggregate by day
    const dailyBreakdown: Record<string, { deals: number; claims: number }> = {};
    for (const deal of deals) {
      const day = (deal.createdAt as string).slice(0, 10);
      if (!dailyBreakdown[day]) dailyBreakdown[day] = { deals: 0, claims: 0 };
      dailyBreakdown[day].deals += 1;
      dailyBreakdown[day].claims += deal.claimCount || 0;
    }

    // Top performing deals
    const topDeals = [...deals]
      .sort((a, b) => (b.claimCount || 0) - (a.claimCount || 0))
      .slice(0, 5)
      .map(({ PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, qrSignature, ...rest }) => ({
        dealId: rest.dealId,
        title: rest.title,
        claimCount: rest.claimCount,
        maxClaims: rest.maxClaims,
        conversionRate: rest.maxClaims > 0 ? ((rest.claimCount || 0) / rest.maxClaims * 100).toFixed(1) : '0',
      }));

    // Redemption rate from Redis
    const r = getRedis();
    const totalRedemptions = parseInt((await r.get(`biz:${businessId}:redemptions`)) || '0', 10);
    const redemptionRate = totalClaims > 0 ? ((totalRedemptions / totalClaims) * 100).toFixed(1) : '0';

    return respond(200, {
      period,
      totalDeals: deals.length,
      totalClaims,
      totalRedemptions,
      totalRevenue,
      redemptionRate: `${redemptionRate}%`,
      categoryBreakdown,
      dailyBreakdown,
      topDeals,
    });
  } catch (err) {
    console.error('getAnalytics error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

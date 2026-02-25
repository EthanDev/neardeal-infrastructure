import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

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
    const period = params.period || 'all'; // 7d, 30d, all

    let startDate: string | undefined;
    if (period === '7d') startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    else if (period === '30d') startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Query all claims for this user
    const queryParams: any = {
      TableName: TABLE_NAME,
      IndexName: 'GSI3',
      KeyConditionExpression: startDate
        ? 'GSI3PK = :pk AND GSI3SK >= :start'
        : 'GSI3PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ...(startDate ? { ':start': `CLAIM#${startDate}` } : {}),
      },
      ScanIndexForward: false,
    };

    const result = await ddb.send(new QueryCommand(queryParams));
    const claims = result.Items || [];

    let totalSaved = 0;
    let totalSpent = 0;
    const categorySavings: Record<string, number> = {};

    for (const claim of claims) {
      if (claim.status === 'redeemed') {
        const saved = ((claim.originalPrice as number) || 0) - ((claim.discountedPrice as number) || 0);
        totalSaved += saved;
        totalSpent += (claim.discountedPrice as number) || 0;
        const cat = (claim.category as string) || 'uncategorized';
        categorySavings[cat] = (categorySavings[cat] || 0) + saved;
      }
    }

    // Monthly breakdown
    const monthlySavings: Record<string, number> = {};
    for (const claim of claims) {
      if (claim.status === 'redeemed' && claim.claimedAt) {
        const month = (claim.claimedAt as string).slice(0, 7); // YYYY-MM
        const saved = ((claim.originalPrice as number) || 0) - ((claim.discountedPrice as number) || 0);
        monthlySavings[month] = (monthlySavings[month] || 0) + saved;
      }
    }

    return respond(200, {
      period,
      totalSaved,
      totalSpent,
      totalDealsRedeemed: claims.filter((c) => c.status === 'redeemed').length,
      totalDealsClaimed: claims.length,
      categorySavings,
      monthlySavings,
    });
  } catch (err) {
    console.error('getSavings error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

    // Get profile for streak count
    const profileRes = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      ProjectionExpression: 'streakCount, lastRedemptionAt, totalClaims',
    }));
    const profile = profileRes.Item;
    if (!profile) return respond(404, { message: 'Profile not found' });

    // Get recent redemptions to compute streak validity
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentClaims = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk AND GSI3SK >= :start',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':start': `CLAIM#${sevenDaysAgo}`,
      },
      ScanIndexForward: false,
    }));

    const recentRedemptions = (recentClaims.Items || []).filter((c) => c.status === 'redeemed');

    // Check if streak is still active (redeemed within last 7 days)
    const lastRedemption = profile.lastRedemptionAt as string | undefined;
    const streakActive = lastRedemption ? (Date.now() - new Date(lastRedemption).getTime()) < 7 * 24 * 60 * 60 * 1000 : false;

    // Streak milestones
    const streakCount = (profile.streakCount as number) || 0;
    const milestones = [5, 10, 25, 50, 100];
    const nextMilestone = milestones.find((m) => m > streakCount) || milestones[milestones.length - 1];

    return respond(200, {
      streakCount,
      streakActive,
      lastRedemptionAt: lastRedemption || null,
      totalClaims: profile.totalClaims || 0,
      recentRedemptions: recentRedemptions.length,
      nextMilestone,
      progressToNextMilestone: nextMilestone > 0 ? ((streakCount / nextMilestone) * 100).toFixed(1) : '100',
    });
  } catch (err) {
    console.error('getStreak error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

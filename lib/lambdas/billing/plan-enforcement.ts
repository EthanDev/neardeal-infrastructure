import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

interface PlanLimits {
  maxDealsPerMonth: number;
  maxActiveDeals: number;
  flashDealsAllowed: boolean;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { maxDealsPerMonth: 5, maxActiveDeals: 2, flashDealsAllowed: false },
  starter: { maxDealsPerMonth: 20, maxActiveDeals: 10, flashDealsAllowed: false },
  pro: { maxDealsPerMonth: 100, maxActiveDeals: 50, flashDealsAllowed: true },
  enterprise: { maxDealsPerMonth: Infinity, maxActiveDeals: Infinity, flashDealsAllowed: true },
};

interface EnforcementRequest {
  businessId: string;
  planTier: string;
  isFlashDeal?: boolean;
}

interface EnforcementResponse {
  allowed: boolean;
  reason?: string;
  currentUsage: {
    monthlyDealCount: number;
    activeDeals: number;
  };
  limits: PlanLimits;
}

export const handler = async (event: EnforcementRequest): Promise<EnforcementResponse> => {
  const { businessId, planTier, isFlashDeal } = event;
  const limits = PLAN_LIMITS[planTier] || PLAN_LIMITS.free;

  try {
    // Count deals created this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const monthlyResult = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :biz AND GSI2SK >= :start',
      ExpressionAttributeValues: {
        ':biz': `BIZ#${businessId}`,
        ':start': `DEAL#${monthStart}`,
      },
      Select: 'COUNT',
    }));

    const monthlyDealCount = monthlyResult.Count || 0;

    // Count currently active deals
    const activeResult = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :biz AND begins_with(GSI2SK, :prefix)',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':biz': `BIZ#${businessId}`,
        ':prefix': 'DEAL#',
        ':active': 'active',
      },
      Select: 'COUNT',
    }));

    const activeDeals = activeResult.Count || 0;
    const currentUsage = { monthlyDealCount, activeDeals };

    // Check monthly limit
    if (monthlyDealCount >= limits.maxDealsPerMonth) {
      return {
        allowed: false,
        reason: `Monthly deal limit reached (${limits.maxDealsPerMonth}). Upgrade your plan for more.`,
        currentUsage,
        limits,
      };
    }

    // Check active deal limit
    if (activeDeals >= limits.maxActiveDeals) {
      return {
        allowed: false,
        reason: `Maximum active deals reached (${limits.maxActiveDeals}). Wait for existing deals to expire or upgrade.`,
        currentUsage,
        limits,
      };
    }

    // Check flash deal permission
    if (isFlashDeal && !limits.flashDealsAllowed) {
      return {
        allowed: false,
        reason: 'Flash deals are not available on your current plan. Upgrade to Pro or Enterprise.',
        currentUsage,
        limits,
      };
    }

    return { allowed: true, currentUsage, limits };
  } catch (err) {
    console.error('Plan enforcement error', err);
    // Fail open: allow the deal but log the error
    return {
      allowed: true,
      reason: 'Enforcement check failed — allowing by default',
      currentUsage: { monthlyDealCount: 0, activeDeals: 0 },
      limits,
    };
  }
};

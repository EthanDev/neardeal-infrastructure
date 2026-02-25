import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac } from 'crypto';
import Redis from 'ioredis';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const REDIS_HOST = process.env.REDIS_HOST!;
const REDIS_PORT = process.env.REDIS_PORT!;
const QR_HMAC_SECRET_ARN = process.env.QR_HMAC_SECRET_ARN!;

let redis: Redis | null = null;
const getRedis = () => {
  if (!redis) redis = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT), lazyConnect: true });
  return redis;
};

let hmacSecret: string | null = null;
const getHmacSecret = async (): Promise<string> => {
  if (!hmacSecret) {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: QR_HMAC_SECRET_ARN }));
    hmacSecret = res.SecretString!;
  }
  return hmacSecret;
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

    const claimId = event.pathParameters?.claimId;
    if (!claimId) return respond(400, { message: 'claimId is required' });

    if (!event.body) return respond(400, { message: 'Missing request body' });
    const { redemptionCode } = JSON.parse(event.body);
    if (!redemptionCode) return respond(400, { message: 'redemptionCode is required' });

    // Parse the redemption code: claimId:hmac
    const parts = redemptionCode.split(':');
    if (parts.length !== 2) return respond(400, { message: 'Invalid redemption code format' });
    const [codeClaimId, providedHmac] = parts;

    if (codeClaimId !== claimId) return respond(400, { message: 'Claim ID mismatch' });

    // Find the claim by querying — we need the dealId and userId from it
    // Use GSI4 or scan by claimId. Since we store claims under DEAL#dealId/CLAIM#userId,
    // we search across the table. A real system would store a claimId lookup item.
    // For now, we also store a lookup item PK=CLAIM#claimId SK=META
    // Actually, let's query by claimId: we need to find the claim.
    // We'll look up CLAIM#claimId in PK as a secondary lookup pattern.

    // Lookup claim metadata
    const claimLookup = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI4',
      KeyConditionExpression: 'GSI4PK = :pk',
      ExpressionAttributeValues: { ':pk': `CLAIM#${claimId}` },
      Limit: 1,
    }));

    // Fallback: scan GSI3 for the claim
    let claim = claimLookup.Items?.[0];
    if (!claim) {
      // Try a broader search
      return respond(404, { message: 'Claim not found' });
    }

    if (claim.businessId !== businessId) return respond(403, { message: 'This claim does not belong to your business' });
    if (claim.status !== 'claimed') return respond(400, { message: `Claim is already ${claim.status}` });

    // Verify HMAC
    const secret = await getHmacSecret();
    const qrPayload = `${claimId}:${claim.dealId}:${claim.userId}`;
    const expectedHmac = createHmac('sha256', secret).update(qrPayload).digest('hex');

    if (providedHmac !== expectedHmac) return respond(400, { message: 'Invalid redemption code' });

    const now = new Date().toISOString();

    // Update claim status
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: claim.PK, SK: claim.SK },
      UpdateExpression: 'SET #st = :redeemed, redeemedAt = :now',
      ConditionExpression: '#st = :claimed',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':redeemed': 'redeemed', ':now': now, ':claimed': 'claimed' },
    }));

    // Update user streak
    await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `USER#${claim.userId}`, SK: 'PROFILE' },
      UpdateExpression: 'SET streakCount = if_not_exists(streakCount, :zero) + :one, lastRedemptionAt = :now, updatedAt = :now',
      ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': now },
    }));

    // Increment business redemption stats in Redis
    const r = getRedis();
    await r.incr(`biz:${businessId}:redemptions`);
    await r.incr(`stats:redemptions:${claim.city || 'unknown'}`);

    return respond(200, { message: 'Claim redeemed successfully', claimId, redeemedAt: now });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return respond(409, { message: 'Claim was already redeemed' });
    }
    console.error('redeemClaim error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

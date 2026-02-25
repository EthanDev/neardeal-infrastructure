import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac, randomUUID } from 'crypto';
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

interface CreateDealBody {
  title: string;
  description: string;
  category: string;
  originalPrice: number;
  discountedPrice: number;
  maxClaims: number;
  expiresAt: string;
  latitude: number;
  longitude: number;
  district: string;
  city: string;
  isFlash?: boolean;
  flashExpiresAt?: string;
  imageUrl?: string;
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const businessId = event.requestContext.authorizer.jwt.claims.sub as string;
    if (!businessId) return respond(401, { message: 'Unauthorized' });

    if (!event.body) return respond(400, { message: 'Missing request body' });
    const body: CreateDealBody = JSON.parse(event.body);

    const { title, description, category, originalPrice, discountedPrice, maxClaims, expiresAt, latitude, longitude, district, city } = body;
    if (!title || !description || !category || !originalPrice || !discountedPrice || !maxClaims || !expiresAt || latitude == null || longitude == null || !district || !city) {
      return respond(400, { message: 'Missing required fields' });
    }
    if (discountedPrice >= originalPrice) return respond(400, { message: 'Discounted price must be less than original price' });

    const dealId = randomUUID();
    const now = new Date().toISOString();
    const secret = await getHmacSecret();
    const qrSignature = createHmac('sha256', secret).update(dealId).digest('hex');

    const item: Record<string, unknown> = {
      PK: `DEAL#${dealId}`,
      SK: 'META',
      GSI1PK: `DEALS#ACTIVE`,
      GSI1SK: expiresAt,
      GSI2PK: `BIZ#${businessId}`,
      GSI2SK: `DEAL#${now}`,
      dealId,
      businessId,
      title,
      description,
      category,
      originalPrice,
      discountedPrice,
      maxClaims,
      claimCount: 0,
      status: 'active',
      district,
      city,
      latitude,
      longitude,
      qrSignature,
      imageUrl: body.imageUrl || '',
      isFlash: body.isFlash || false,
      flashExpiresAt: body.flashExpiresAt || '',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

    // Index in Redis geo set for nearby queries
    const r = getRedis();
    await r.geoadd(`geo:deals:${city}`, longitude, latitude, dealId);
    // Cache deal metadata
    await r.set(`deal:${dealId}`, JSON.stringify(item), 'EX', 3600);

    if (body.isFlash) {
      const flashTtl = Math.floor((new Date(body.flashExpiresAt!).getTime() - Date.now()) / 1000);
      if (flashTtl > 0) {
        await r.set(`flash:${city}:${dealId}`, JSON.stringify({ dealId, title, discountedPrice, originalPrice, flashExpiresAt: body.flashExpiresAt }), 'EX', flashTtl);
      }
    }

    // Increment city stats
    await r.incr(`stats:deals:${city}`);

    return respond(201, { dealId, qrSignature, message: 'Deal created' });
  } catch (err) {
    console.error('createDeal error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

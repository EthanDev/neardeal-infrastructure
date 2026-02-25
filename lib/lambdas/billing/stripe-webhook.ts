import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac, timingSafeEqual } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const STRIPE_WEBHOOK_SECRET_ARN = process.env.STRIPE_WEBHOOK_SECRET_ARN!;

let webhookSecret: string | null = null;
const getWebhookSecret = async (): Promise<string> => {
  if (!webhookSecret) {
    const res = await sm.send(new GetSecretValueCommand({ SecretId: STRIPE_WEBHOOK_SECRET_ARN }));
    webhookSecret = res.SecretString!;
  }
  return webhookSecret;
};

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
  const parts = sigHeader.split(',');
  let timestamp = '';
  let signature = '';
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signature = value;
  }
  if (!timestamp || !signature) return false;

  // Reject if timestamp is older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = event.body;
    if (!body) return respond(400, { message: 'Missing body' });

    const sigHeader = event.headers['stripe-signature'];
    if (!sigHeader) return respond(400, { message: 'Missing Stripe-Signature header' });

    const secret = await getWebhookSecret();
    const rawBody = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;

    if (!verifyStripeSignature(rawBody, sigHeader, secret)) {
      return respond(401, { message: 'Invalid signature' });
    }

    const stripeEvent = JSON.parse(rawBody);
    const eventType = stripeEvent.type as string;
    const now = new Date().toISOString();

    switch (eventType) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const businessId = session.metadata?.businessId;
        const planTier = session.metadata?.planTier;
        if (businessId && planTier) {
          await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
            UpdateExpression: 'SET planTier = :tier, stripeCustomerId = :custId, subscriptionStatus = :status, updatedAt = :now',
            ExpressionAttributeValues: {
              ':tier': planTier,
              ':custId': session.customer || '',
              ':status': 'active',
              ':now': now,
            },
          }));
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;
        const businessId = subscription.metadata?.businessId;
        if (businessId) {
          const status = subscription.status === 'active' ? 'active' : subscription.status;
          await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
            UpdateExpression: 'SET subscriptionStatus = :status, updatedAt = :now',
            ExpressionAttributeValues: { ':status': status, ':now': now },
          }));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const businessId = subscription.metadata?.businessId;
        if (businessId) {
          await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
            UpdateExpression: 'SET planTier = :free, subscriptionStatus = :cancelled, updatedAt = :now',
            ExpressionAttributeValues: { ':free': 'free', ':cancelled': 'cancelled', ':now': now },
          }));
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const businessId = invoice.metadata?.businessId || invoice.subscription_details?.metadata?.businessId;
        if (businessId) {
          await ddb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
            UpdateExpression: 'SET subscriptionStatus = :pastDue, updatedAt = :now',
            ExpressionAttributeValues: { ':pastDue': 'past_due', ':now': now },
          }));
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${eventType}`);
    }

    return respond(200, { received: true });
  } catch (err) {
    console.error('stripeWebhook error', err);
    return respond(500, { message: 'Webhook processing error' });
  }
};

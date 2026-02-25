import { DynamoDBStreamEvent, DynamoDBBatchResponse, DynamoDBBatchItemFailure } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const REDIS_HOST = process.env.REDIS_HOST!;
const REDIS_PORT = process.env.REDIS_PORT!;

let redis: Redis | null = null;
const getRedis = () => {
  if (!redis) redis = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT), lazyConnect: true });
  return redis;
};

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: DynamoDBBatchItemFailure[] = [];
  const r = getRedis();
  await r.connect().catch(() => {});

  for (const record of event.Records) {
    try {
      // Only process TTL deletions (REMOVE events where the old image has deal data)
      if (record.eventName !== 'REMOVE') continue;

      const oldImage = record.dynamodb?.OldImage;
      if (!oldImage) continue;

      const item = unmarshall(oldImage as Record<string, AttributeValue>);

      // Only process deal items
      const pk = item.PK as string;
      if (!pk?.startsWith('DEAL#')) continue;

      const dealId = item.dealId as string;
      const businessId = item.businessId as string;
      const city = item.city as string;
      const title = item.title as string;
      const claimCount = (item.claimCount as number) || 0;

      console.log(`Processing expiry for deal ${dealId} (business: ${businessId})`);

      // 1. Clean up Redis GEO index
      if (city) {
        await r.zrem(`geo:deals:${city}`, dealId);
      }

      // Clean up cached deal data
      await r.del(`deal:${dealId}`);
      if (item.isFlash && city) {
        await r.del(`flash:${city}:${dealId}`);
      }

      // Decrement city stats
      if (city) {
        await r.decr(`stats:deals:${city}`);
      }

      // 2. Send notification to business about deal expiry
      const now = new Date().toISOString();
      const notificationId = randomUUID();
      await ddb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `BIZ#${businessId}`,
          SK: `NOTIF#${now}#${notificationId}`,
          GSI1PK: `NOTIF#BIZ#${businessId}`,
          GSI1SK: now,
          notificationId,
          businessId,
          dealId,
          type: 'DEAL_EXPIRED',
          title: `Deal expired: ${title}`,
          body: `Your deal "${title}" has expired with ${claimCount} total claims.`,
          read: false,
          createdAt: now,
        },
      }));

      // 3. Write final analytics summary
      await ddb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: 'ANALYTICS#SUMMARY',
        },
        UpdateExpression: 'SET #status = :expired, #finalClaimCount = :claims, #expiredAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#finalClaimCount': 'finalClaimCount',
          '#expiredAt': 'expiredAt',
        },
        ExpressionAttributeValues: {
          ':expired': 'expired',
          ':claims': claimCount,
          ':now': now,
        },
      }));

      console.log(`Completed expiry cleanup for deal ${dealId}`);
    } catch (err) {
      console.error('Error processing stream record', record.eventID, err);
      if (record.dynamodb?.SequenceNumber) {
        batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      }
    }
  }

  return { batchItemFailures };
};

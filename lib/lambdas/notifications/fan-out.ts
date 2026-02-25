import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

interface DealEvent {
  dealId: string;
  businessId: string;
  title: string;
  city: string;
  latitude: number;
  longitude: number;
  category: string;
  discountedPrice: number;
  originalPrice: number;
}

const NOTIFICATION_RADIUS_KM = 5;
const THROTTLE_WINDOW_SECONDS = 3600; // 1 hour between notifications per user

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  const r = getRedis();
  await r.connect().catch(() => {});

  for (const record of event.Records) {
    try {
      const dealEvent: DealEvent = JSON.parse(record.body);
      const { dealId, city, latitude, longitude, category, title, discountedPrice, originalPrice } = dealEvent;

      // Find nearby consumers using Redis GEORADIUS
      const nearbyConsumers = await r.georadius(
        `geo:consumers:${city}`,
        longitude,
        latitude,
        NOTIFICATION_RADIUS_KM,
        'km',
        'WITHCOORD',
        'COUNT',
        500,
      );

      if (!nearbyConsumers || nearbyConsumers.length === 0) {
        console.log(`No nearby consumers found for deal ${dealId} in ${city}`);
        continue;
      }

      const now = new Date().toISOString();
      const timestamp = Date.now();

      for (const entry of nearbyConsumers) {
        const consumerId = Array.isArray(entry) ? (entry[0] as string) : (entry as string);

        // Check throttle: skip if consumer was recently notified
        const throttleKey = `throttle:${consumerId}:deals`;
        const lastNotified = await r.get(throttleKey);
        if (lastNotified && timestamp - Number(lastNotified) < THROTTLE_WINDOW_SECONDS * 1000) {
          continue;
        }

        // Check consumer preferences from DynamoDB
        const prefResult = await ddb.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: {
            ':pk': `USER#${consumerId}`,
            ':sk': 'PREFERENCES',
          },
          Limit: 1,
        }));

        const preferences = prefResult.Items?.[0];
        if (preferences) {
          const preferredCategories = (preferences.categories as string[] | undefined) || [];
          if (preferredCategories.length > 0 && !preferredCategories.includes(category)) {
            continue; // Consumer not interested in this category
          }
        }

        // Write notification record to DynamoDB
        const notificationId = randomUUID();
        await ddb.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `USER#${consumerId}`,
            SK: `NOTIF#${now}#${notificationId}`,
            GSI1PK: `NOTIF#${consumerId}`,
            GSI1SK: now,
            notificationId,
            consumerId,
            dealId,
            type: 'NEARBY_DEAL',
            title: `New deal nearby: ${title}`,
            body: `Save ${Math.round((1 - discountedPrice / originalPrice) * 100)}% — ${title}`,
            category,
            read: false,
            createdAt: now,
          },
        }));

        // Update throttle timestamp
        await r.set(throttleKey, String(timestamp), 'EX', THROTTLE_WINDOW_SECONDS);
      }

      console.log(`Processed deal ${dealId}: notified consumers in ${city}`);
    } catch (err) {
      console.error('Error processing record', record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

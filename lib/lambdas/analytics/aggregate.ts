import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

interface AnalyticsEvent {
  eventType: 'deal_view' | 'deal_claim' | 'deal_share' | 'deal_expire' | 'search';
  dealId?: string;
  businessId?: string;
  consumerId?: string;
  city?: string;
  category?: string;
  timestamp: string;
  metadata?: Record<string, string | number>;
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  const r = getRedis();
  await r.connect().catch(() => {});

  for (const record of event.Records) {
    try {
      const analytics: AnalyticsEvent = JSON.parse(record.body);
      const { eventType, dealId, businessId, city, category, timestamp } = analytics;
      const dateKey = timestamp.slice(0, 10); // YYYY-MM-DD

      // Increment real-time counters in Redis
      const pipeline = r.pipeline();

      if (city) {
        pipeline.hincrby(`analytics:daily:${dateKey}`, `${eventType}:${city}`, 1);
      }
      if (category) {
        pipeline.hincrby(`analytics:daily:${dateKey}`, `${eventType}:cat:${category}`, 1);
      }
      if (businessId) {
        pipeline.hincrby(`analytics:biz:${businessId}:${dateKey}`, eventType, 1);
      }
      if (dealId) {
        pipeline.hincrby(`analytics:deal:${dealId}`, eventType, 1);
      }

      // Set TTL on daily keys (7 days)
      pipeline.expire(`analytics:daily:${dateKey}`, 7 * 86400);
      if (businessId) {
        pipeline.expire(`analytics:biz:${businessId}:${dateKey}`, 30 * 86400);
      }

      await pipeline.exec();

      // Write aggregated record to DynamoDB for durable storage
      if (businessId) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `BIZ#${businessId}`,
            SK: `ANALYTICS#${dateKey}#${eventType}`,
          },
          UpdateExpression: 'SET #cnt = if_not_exists(#cnt, :zero) + :one, #updated = :ts, #eventType = :et',
          ExpressionAttributeNames: {
            '#cnt': 'count',
            '#updated': 'updatedAt',
            '#eventType': 'eventType',
          },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':ts': new Date().toISOString(),
            ':et': eventType,
          },
        }));
      }

      if (dealId) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            PK: `DEAL#${dealId}`,
            SK: `ANALYTICS#${eventType}`,
          },
          UpdateExpression: 'SET #cnt = if_not_exists(#cnt, :zero) + :one, #updated = :ts',
          ExpressionAttributeNames: {
            '#cnt': 'count',
            '#updated': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':ts': new Date().toISOString(),
          },
        }));
      }

      console.log(`Aggregated ${eventType} event for deal=${dealId} biz=${businessId}`);
    } catch (err) {
      console.error('Error processing analytics record', record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

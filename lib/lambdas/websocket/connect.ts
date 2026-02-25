import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: any): Promise<APIGatewayProxyResultV2> => {
  try {
    const connectionId = event.requestContext.connectionId;
    const userId = event.queryStringParameters?.userId || 'anonymous';
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h TTL

    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `WS#${connectionId}`,
        SK: 'CONNECTION',
        GSI1PK: `WSUSER#${userId}`,
        GSI1SK: now,
        connectionId,
        userId,
        connectedAt: now,
        expiresAt: ttl,
      },
    }));

    return { statusCode: 200, body: 'Connected' };
  } catch (err) {
    console.error('ws connect error', err);
    return { statusCode: 500, body: 'Connection failed' };
  }
};

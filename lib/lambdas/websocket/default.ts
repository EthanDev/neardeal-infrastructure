import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: any): Promise<APIGatewayProxyResultV2> => {
  try {
    const connectionId = event.requestContext.connectionId;
    const { domainName, stage } = event.requestContext;
    const endpoint = `https://${domainName}/${stage}`;
    const apigw = new ApiGatewayManagementApiClient({ endpoint });

    const body = JSON.parse(event.body || '{}');
    const action = body.action as string;

    // Look up the connection to get userId
    const connRes = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `WS#${connectionId}`, SK: 'CONNECTION' },
    }));
    const userId = connRes.Item?.userId as string;

    switch (action) {
      case 'ping': {
        await apigw.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ action: 'pong', timestamp: new Date().toISOString() })),
        }));
        break;
      }

      case 'subscribe': {
        // Subscribe to deal updates for a city
        const city = body.city || 'bucharest';
        // Store subscription
        await ddb.send(new (await import('@aws-sdk/lib-dynamodb')).PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: `WS#${connectionId}`,
            SK: `SUB#${city}`,
            GSI1PK: `WSCITY#${city}`,
            GSI1SK: connectionId,
            userId,
            city,
            subscribedAt: new Date().toISOString(),
            expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          },
        }));
        await apigw.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ action: 'subscribed', city })),
        }));
        break;
      }

      default: {
        await apigw.send(new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify({ action: 'error', message: `Unknown action: ${action}` })),
        }));
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('ws default error', err);
    return { statusCode: 500, body: 'Error' };
  }
};

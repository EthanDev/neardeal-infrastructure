import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: any): Promise<APIGatewayProxyResultV2> => {
  try {
    const connectionId = event.requestContext.connectionId;

    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `WS#${connectionId}`, SK: 'CONNECTION' },
    }));

    return { statusCode: 200, body: 'Disconnected' };
  } catch (err) {
    console.error('ws disconnect error', err);
    return { statusCode: 500, body: 'Disconnect failed' };
  }
};

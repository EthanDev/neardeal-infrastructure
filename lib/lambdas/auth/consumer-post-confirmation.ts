import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
  const { sub, email, name } = event.request.userAttributes;
  const now = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `USER#${sub}`,
        SK: 'PROFILE',
        email,
        name: name || '',
        preferredCategories: [],
        homeDistrict: '',
        streakCount: 0,
        totalClaims: 0,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  return event;
};

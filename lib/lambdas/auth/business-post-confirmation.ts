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
        PK: `BUSINESS#${sub}`,
        SK: 'PROFILE',
        email,
        businessName: name || '',
        planTier: 'free',
        monthlyDealCount: 0,
        stripeCustomerId: '',
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  // TODO: Create geofence via Amazon Location Service integration
  console.log(`TODO: Create geofence for business ${sub} via Location Service`);

  return event;
};

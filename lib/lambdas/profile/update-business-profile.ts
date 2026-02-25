import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

const ALLOWED_FIELDS = ['businessName', 'address', 'district', 'city', 'phone', 'website', 'description', 'logoUrl', 'coverImageUrl', 'categories', 'openingHours', 'latitude', 'longitude'];

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const businessId = event.requestContext.authorizer.jwt.claims.sub as string;
    if (!businessId) return respond(401, { message: 'Unauthorized' });

    if (!event.body) return respond(400, { message: 'Missing request body' });
    const body = JSON.parse(event.body);

    const expressionParts: string[] = [];
    const expressionValues: Record<string, unknown> = {};
    const expressionNames: Record<string, string> = {};

    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        const placeholder = `:${field}`;
        const nameAlias = `#${field}`;
        expressionParts.push(`${nameAlias} = ${placeholder}`);
        expressionValues[placeholder] = body[field];
        expressionNames[nameAlias] = field;
      }
    }

    if (expressionParts.length === 0) return respond(400, { message: 'No valid fields to update' });

    expressionParts.push('#updatedAt = :updatedAt');
    expressionValues[':updatedAt'] = new Date().toISOString();
    expressionNames['#updatedAt'] = 'updatedAt';

    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BIZ#${businessId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ConditionExpression: 'attribute_exists(PK)',
      ReturnValues: 'ALL_NEW',
    }));

    const { PK, SK, ...profile } = result.Attributes || {};
    return respond(200, { profile });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return respond(404, { message: 'Business profile not found' });
    }
    console.error('updateBusinessProfile error', err);
    return respond(500, { message: 'Internal server error' });
  }
};

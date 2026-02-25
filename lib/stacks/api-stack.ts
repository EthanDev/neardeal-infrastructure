import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';
import * as path from 'path';
import { StageConfig } from '../config/stage-config';

interface ApiStackProps extends cdk.StackProps {
  config: StageConfig;
  consumerUserPool: cognito.IUserPool;
  consumerUserPoolClient: cognito.IUserPoolClient;
  businessUserPool: cognito.IUserPool;
  businessUserPoolClient: cognito.IUserPoolClient;
  table: dynamodb.ITable;
  vpc: ec2.IVpc;
  redisSecurityGroup: ec2.ISecurityGroup;
  redisEndpoint: string;
  redisPort: string;
  qrHmacSecret: secretsmanager.ISecret;
  stripeWebhookSecret: secretsmanager.ISecret;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: HttpApi;
  public readonly webSocketApi: WebSocketApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // ─── JWT Authorizers ───

    const consumerIssuerUrl = `https://cognito-idp.${config.region}.amazonaws.com/${props.consumerUserPool.userPoolId}`;
    const businessIssuerUrl = `https://cognito-idp.${config.region}.amazonaws.com/${props.businessUserPool.userPoolId}`;

    const consumerAuthorizer = new HttpJwtAuthorizer('ConsumerAuthorizer', consumerIssuerUrl, {
      jwtAudience: [props.consumerUserPoolClient.userPoolClientId],
    });

    const businessAuthorizer = new HttpJwtAuthorizer('BusinessAuthorizer', businessIssuerUrl, {
      jwtAudience: [props.businessUserPoolClient.userPoolClientId],
    });

    // ─── HTTP API ───

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `neardeal-api-${stage}`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Apply throttling via CfnStage
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as cdk.aws_apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: config.apiThrottling.rateLimit,
        throttlingBurstLimit: config.apiThrottling.burstLimit,
      };
    }

    // ─── Shared Lambda Props ───

    const lambdasDir = path.join(__dirname, '..', 'lambdas');

    const sharedEnv: Record<string, string> = {
      TABLE_NAME: props.table.tableName,
      REDIS_HOST: props.redisEndpoint,
      REDIS_PORT: props.redisPort,
    };

    const sharedBundling = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    };

    const sharedLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.redisSecurityGroup],
      bundling: sharedBundling,
    };

    // ─── Helper to create a Lambda ───

    const createLambda = (
      id: string,
      entry: string,
      extraEnv?: Record<string, string>,
    ): NodejsFunction => {
      const fn = new NodejsFunction(this, id, {
        ...sharedLambdaProps,
        functionName: `neardeal-${stage}-${id}`,
        entry,
        environment: { ...sharedEnv, ...extraEnv },
      });
      props.table.grantReadWriteData(fn);
      return fn;
    };

    // ─── Lambda Functions ───

    // 1. POST /api/deals — createDeal (business)
    const createDealFn = createLambda('CreateDeal', path.join(lambdasDir, 'deals', 'create-deal.ts'), {
      QR_HMAC_SECRET_ARN: props.qrHmacSecret.secretArn,
    });
    props.qrHmacSecret.grantRead(createDealFn);

    // 2. GET /api/deals/nearby — getNearbyDeals (consumer)
    const getNearbyDealsFn = createLambda('GetNearbyDeals', path.join(lambdasDir, 'deals', 'get-nearby-deals.ts'));

    // 3. GET /api/deals/flash — getFlashDeal (consumer)
    const getFlashDealFn = createLambda('GetFlashDeal', path.join(lambdasDir, 'deals', 'get-flash-deal.ts'));

    // 4. GET /api/deals/{dealId} — getDeal (consumer)
    const getDealFn = createLambda('GetDeal', path.join(lambdasDir, 'deals', 'get-deal.ts'));

    // 5. POST /api/claims — createClaim (consumer)
    const createClaimFn = createLambda('CreateClaim', path.join(lambdasDir, 'claims', 'create-claim.ts'), {
      QR_HMAC_SECRET_ARN: props.qrHmacSecret.secretArn,
    });
    props.qrHmacSecret.grantRead(createClaimFn);

    // 6. POST /api/claims/{claimId}/redeem — redeemClaim (business)
    const redeemClaimFn = createLambda('RedeemClaim', path.join(lambdasDir, 'claims', 'redeem-claim.ts'), {
      QR_HMAC_SECRET_ARN: props.qrHmacSecret.secretArn,
    });
    props.qrHmacSecret.grantRead(redeemClaimFn);

    // 7. GET /api/business/dashboard — getDashboard (business)
    const getDashboardFn = createLambda('GetDashboard', path.join(lambdasDir, 'profile', 'get-dashboard.ts'));

    // 8. GET /api/business/analytics — getAnalytics (business)
    const getAnalyticsFn = createLambda('GetAnalytics', path.join(lambdasDir, 'profile', 'get-analytics.ts'));

    // 9. PUT /api/consumer/profile — updateConsumerProfile (consumer)
    const updateConsumerProfileFn = createLambda('UpdateConsumerProfile', path.join(lambdasDir, 'profile', 'update-consumer-profile.ts'));

    // 10. PUT /api/business/profile — updateBusinessProfile (business)
    const updateBusinessProfileFn = createLambda('UpdateBusinessProfile', path.join(lambdasDir, 'profile', 'update-business-profile.ts'));

    // 11. POST /api/saves/{dealId} — toggleSave (consumer)
    const toggleSaveFn = createLambda('ToggleSave', path.join(lambdasDir, 'deals', 'toggle-save.ts'));

    // 12. GET /api/saves — getSaves (consumer)
    const getSavesFn = createLambda('GetSaves', path.join(lambdasDir, 'deals', 'get-saves.ts'));

    // 13. GET /api/consumer/streak — getStreak (consumer)
    const getStreakFn = createLambda('GetStreak', path.join(lambdasDir, 'profile', 'get-streak.ts'));

    // 14. GET /api/consumer/savings — getSavings (consumer)
    const getSavingsFn = createLambda('GetSavings', path.join(lambdasDir, 'profile', 'get-savings.ts'));

    // 15. GET /api/stats/city — getCityStats (no auth)
    const getCityStatsFn = createLambda('GetCityStats', path.join(lambdasDir, 'deals', 'get-city-stats.ts'));

    // 16. POST /api/webhooks/stripe — stripeWebhook (no auth)
    const stripeWebhookFn = createLambda('StripeWebhook', path.join(lambdasDir, 'billing', 'stripe-webhook.ts'), {
      STRIPE_WEBHOOK_SECRET_ARN: props.stripeWebhookSecret.secretArn,
    });
    props.stripeWebhookSecret.grantRead(stripeWebhookFn);

    // ─── HTTP API Routes ───

    this.httpApi.addRoutes({
      path: '/api/deals',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateDealIntegration', createDealFn),
      authorizer: businessAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/deals/nearby',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetNearbyDealsIntegration', getNearbyDealsFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/deals/flash',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetFlashDealIntegration', getFlashDealFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/deals/{dealId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetDealIntegration', getDealFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/claims',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateClaimIntegration', createClaimFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/claims/{claimId}/redeem',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('RedeemClaimIntegration', redeemClaimFn),
      authorizer: businessAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/business/dashboard',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetDashboardIntegration', getDashboardFn),
      authorizer: businessAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/business/analytics',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetAnalyticsIntegration', getAnalyticsFn),
      authorizer: businessAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/consumer/profile',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpdateConsumerProfileIntegration', updateConsumerProfileFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/business/profile',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('UpdateBusinessProfileIntegration', updateBusinessProfileFn),
      authorizer: businessAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/saves/{dealId}',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ToggleSaveIntegration', toggleSaveFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/saves',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetSavesIntegration', getSavesFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/consumer/streak',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetStreakIntegration', getStreakFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/consumer/savings',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetSavingsIntegration', getSavingsFn),
      authorizer: consumerAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/stats/city',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetCityStatsIntegration', getCityStatsFn),
    });

    this.httpApi.addRoutes({
      path: '/api/webhooks/stripe',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('StripeWebhookIntegration', stripeWebhookFn),
    });

    // ─── Provisioned Concurrency ───

    if (config.lambda.nearbyDealsProvisionedConcurrency > 0) {
      const nearbyAlias = new lambda.Alias(this, 'GetNearbyDealsAlias', {
        aliasName: 'live',
        version: getNearbyDealsFn.currentVersion,
        provisionedConcurrentExecutions: config.lambda.nearbyDealsProvisionedConcurrency,
      });
    }

    if (config.lambda.createClaimProvisionedConcurrency > 0) {
      const claimAlias = new lambda.Alias(this, 'CreateClaimAlias', {
        aliasName: 'live',
        version: createClaimFn.currentVersion,
        provisionedConcurrentExecutions: config.lambda.createClaimProvisionedConcurrency,
      });
    }

    // ─── WebSocket API ───

    const wsConnectFn = createLambda('WsConnect', path.join(lambdasDir, 'websocket', 'connect.ts'));
    const wsDisconnectFn = createLambda('WsDisconnect', path.join(lambdasDir, 'websocket', 'disconnect.ts'));
    const wsDefaultFn = createLambda('WsDefault', path.join(lambdasDir, 'websocket', 'default.ts'));

    this.webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
      apiName: `neardeal-ws-${stage}`,
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('WsConnectIntegration', wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('WsDisconnectIntegration', wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('WsDefaultIntegration', wsDefaultFn),
      },
    });

    const wsStage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: stage,
      autoDeploy: true,
    });

    // Grant WebSocket management API permissions to default handler
    wsDefaultFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/${stage}/*`,
      ],
    }));

    // ─── Outputs ───

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: `NearDeal-${stage}-HttpApiUrl`,
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: wsStage.url,
      exportName: `NearDeal-${stage}-WebSocketApiUrl`,
    });
  }
}

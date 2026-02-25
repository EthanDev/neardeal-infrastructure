import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { StageConfig } from '../config/stage-config';

interface AuthStackProps extends cdk.StackProps {
  config: StageConfig;
  table: dynamodb.ITable;
}

export class AuthStack extends cdk.Stack {
  public readonly consumerUserPool: cognito.UserPool;
  public readonly businessUserPool: cognito.UserPool;
  public readonly consumerUserPoolClient: cognito.UserPoolClient;
  public readonly businessUserPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;

    const table = props.table;

    // ──────────────────────────────────────────────
    // Consumer Post-Confirmation Lambda
    // ──────────────────────────────────────────────
    const consumerPostConfirmationFn = new NodejsFunction(this, 'ConsumerPostConfirmationFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'auth', 'consumer-post-confirmation.ts'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // ──────────────────────────────────────────────
    // Business Post-Confirmation Lambda
    // ──────────────────────────────────────────────
    const businessPostConfirmationFn = new NodejsFunction(this, 'BusinessPostConfirmationFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'auth', 'business-post-confirmation.ts'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // ──────────────────────────────────────────────
    // Consumer User Pool
    // ──────────────────────────────────────────────
    this.consumerUserPool = new cognito.UserPool(this, 'ConsumerUserPool', {
      userPoolName: `neardeal-${config.stage}-consumer-pool`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        preferredCategories: new cognito.StringAttribute({ mutable: true }),
        homeDistrict: new cognito.StringAttribute({ mutable: true }),
        streakCount: new cognito.NumberAttribute({ mutable: true }),
        totalClaims: new cognito.NumberAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireLowercase: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lambdaTriggers: {
        postConfirmation: consumerPostConfirmationFn,
      },
    });

    // Consumer Cognito domain
    this.consumerUserPool.addDomain('ConsumerDomain', {
      cognitoDomain: {
        domainPrefix: `neardeal-${config.stage}-consumer`,
      },
    });

    // Consumer app client
    this.consumerUserPoolClient = this.consumerUserPool.addClient('ConsumerAppClient', {
      userPoolClientName: `neardeal-${config.stage}-consumer-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ──────────────────────────────────────────────
    // Business User Pool
    // ──────────────────────────────────────────────
    this.businessUserPool = new cognito.UserPool(this, 'BusinessUserPool', {
      userPoolName: `neardeal-${config.stage}-business-pool`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        businessId: new cognito.StringAttribute({ mutable: true }),
        planTier: new cognito.StringAttribute({ mutable: true }),
        stripeCustomerId: new cognito.StringAttribute({ mutable: true }),
        monthlyDealCount: new cognito.NumberAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireLowercase: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: config.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      lambdaTriggers: {
        postConfirmation: businessPostConfirmationFn,
      },
    });

    // Business Cognito domain
    this.businessUserPool.addDomain('BusinessDomain', {
      cognitoDomain: {
        domainPrefix: `neardeal-${config.stage}-business`,
      },
    });

    // Business app client
    this.businessUserPoolClient = this.businessUserPool.addClient('BusinessAppClient', {
      userPoolClientName: `neardeal-${config.stage}-business-client`,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Grant Lambdas DynamoDB write access
    table.grantWriteData(consumerPostConfirmationFn);
    table.grantWriteData(businessPostConfirmationFn);

    // ──────────────────────────────────────────────
    // Outputs
    // ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ConsumerUserPoolId', {
      value: this.consumerUserPool.userPoolId,
      exportName: `NearDeal-${config.stage}-ConsumerUserPoolId`,
    });

    new cdk.CfnOutput(this, 'BusinessUserPoolId', {
      value: this.businessUserPool.userPoolId,
      exportName: `NearDeal-${config.stage}-BusinessUserPoolId`,
    });

    new cdk.CfnOutput(this, 'ConsumerUserPoolClientId', {
      value: this.consumerUserPoolClient.userPoolClientId,
      exportName: `NearDeal-${config.stage}-ConsumerUserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'BusinessUserPoolClientId', {
      value: this.businessUserPoolClient.userPoolClientId,
      exportName: `NearDeal-${config.stage}-BusinessUserPoolClientId`,
    });
  }
}

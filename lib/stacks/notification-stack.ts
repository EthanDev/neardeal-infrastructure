import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ses from 'aws-cdk-lib/aws-ses';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { StageConfig } from '../config/stage-config';

interface NotificationStackProps extends cdk.StackProps {
  config: StageConfig;
  table: dynamodb.ITable;
  vpc: ec2.IVpc;
  redisSecurityGroup: ec2.ISecurityGroup;
  redisEndpoint: string;
  redisPort: string;
}

export class NotificationStack extends cdk.Stack {
  public readonly dealsQueue: sqs.IQueue;
  public readonly analyticsQueue: sqs.IQueue;
  public readonly businessAlertsQueue: sqs.IQueue;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    const { config, table, vpc, redisSecurityGroup, redisEndpoint, redisPort } = props;
    const stage = config.stage;

    // ─── SQS Queues ───

    // Deals FIFO queue with DLQ
    const dealsDlq = new sqs.Queue(this, 'DealsDLQ', {
      queueName: `neardeal-deals-dlq-${stage}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const dealsQueue = new sqs.Queue(this, 'DealsQueue', {
      queueName: `neardeal-deals-${stage}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: dealsDlq,
        maxReceiveCount: 3,
      },
    });

    // Analytics standard queue with DLQ
    const analyticsDlq = new sqs.Queue(this, 'AnalyticsDLQ', {
      queueName: `neardeal-analytics-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const analyticsQueue = new sqs.Queue(this, 'AnalyticsQueue', {
      queueName: `neardeal-analytics-${stage}`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: analyticsDlq,
        maxReceiveCount: 3,
      },
    });

    // Business alerts standard queue with DLQ
    const businessAlertsDlq = new sqs.Queue(this, 'BusinessAlertsDLQ', {
      queueName: `neardeal-business-alerts-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const businessAlertsQueue = new sqs.Queue(this, 'BusinessAlertsQueue', {
      queueName: `neardeal-business-alerts-${stage}`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: businessAlertsDlq,
        maxReceiveCount: 3,
      },
    });

    // Use the Redis security group directly so lambdas can access Redis
    // without creating a cross-stack circular dependency
    const lambdaSg = redisSecurityGroup;

    // ─── Notification Fan-out Lambda ───

    const fanOutFn = new NodejsFunction(this, 'FanOutFn', {
      functionName: `neardeal-notification-fanout-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'notifications', 'fan-out.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: redisPort,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    table.grantReadWriteData(fanOutFn);
    fanOutFn.addEventSource(new SqsEventSource(dealsQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }));

    // ─── Analytics Aggregation Lambda ───

    const aggregateFn = new NodejsFunction(this, 'AggregateFn', {
      functionName: `neardeal-analytics-aggregate-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'analytics', 'aggregate.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        REDIS_HOST: redisEndpoint,
        REDIS_PORT: redisPort,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    table.grantReadWriteData(aggregateFn);
    aggregateFn.addEventSource(new SqsEventSource(analyticsQueue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));

    // ─── SES Email Identity ───

    new ses.CfnEmailIdentity(this, 'NotificationEmailIdentity', {
      emailIdentity: `notifications-${stage}@neardeal.ro`,
    });

    // ─── Exports ───

    this.dealsQueue = dealsQueue;
    this.analyticsQueue = analyticsQueue;
    this.businessAlertsQueue = businessAlertsQueue;

    new cdk.CfnOutput(this, 'DealsQueueUrl', {
      value: dealsQueue.queueUrl,
      exportName: `NearDeal-${stage}-DealsQueueUrl`,
    });

    new cdk.CfnOutput(this, 'DealsQueueArn', {
      value: dealsQueue.queueArn,
      exportName: `NearDeal-${stage}-DealsQueueArn`,
    });

    new cdk.CfnOutput(this, 'AnalyticsQueueUrl', {
      value: analyticsQueue.queueUrl,
      exportName: `NearDeal-${stage}-AnalyticsQueueUrl`,
    });

    new cdk.CfnOutput(this, 'BusinessAlertsQueueUrl', {
      value: businessAlertsQueue.queueUrl,
      exportName: `NearDeal-${stage}-BusinessAlertsQueueUrl`,
    });
  }
}

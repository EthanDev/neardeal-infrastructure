import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { StageConfig } from '../config/stage-config';

interface BillingStackProps extends cdk.StackProps {
  config: StageConfig;
  table: dynamodb.ITable;
  vpc?: ec2.IVpc;
  redisSecurityGroup?: ec2.ISecurityGroup;
  redisEndpoint?: string;
  redisPort?: string;
}

export class BillingStack extends cdk.Stack {
  public readonly planEnforcementFn: lambda.IFunction;
  public readonly dealExpiryFn: lambda.IFunction;

  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, props);

    const { config, table, vpc, redisSecurityGroup, redisEndpoint, redisPort } = props;
    const stage = config.stage;

    // ─── Plan Enforcement Lambda ───

    this.planEnforcementFn = new NodejsFunction(this, 'PlanEnforcementFn', {
      functionName: `neardeal-plan-enforcement-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'billing', 'plan-enforcement.ts'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    table.grantReadData(this.planEnforcementFn);

    // ─── Deal Expiry Lambda (triggered by DynamoDB Streams) ───

    // Use the Redis security group directly to avoid cross-stack circular deps
    this.dealExpiryFn = new NodejsFunction(this, 'DealExpiryFn', {
      functionName: `neardeal-deal-expiry-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '..', 'lambdas', 'billing', 'deal-expiry.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        REDIS_HOST: redisEndpoint || '',
        REDIS_PORT: redisPort || '',
      },
      ...(vpc ? {
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: redisSecurityGroup ? [redisSecurityGroup] : undefined,
      } : {}),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    table.grantReadWriteData(this.dealExpiryFn);

    // Add DynamoDB Stream event source
    this.dealExpiryFn.addEventSource(new DynamoEventSource(table, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      bisectBatchOnError: true,
      retryAttempts: 3,
      reportBatchItemFailures: true,
      filters: [
        lambda.FilterCriteria.filter({
          eventName: lambda.FilterRule.isEqual('REMOVE'),
        }),
      ],
    }));

    // ─── Exports ───

    new cdk.CfnOutput(this, 'PlanEnforcementFnArn', {
      value: this.planEnforcementFn.functionArn,
      exportName: `NearDeal-${stage}-PlanEnforcementFnArn`,
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { StageConfig } from '../config/stage-config';

interface MonitoringStackProps extends cdk.StackProps {
  config: StageConfig;
  apiName: string;
  lambdaFunctions: lambda.IFunction[];
  queues: sqs.IQueue[];
  dlqs: sqs.IQueue[];
}

export class MonitoringStack extends cdk.Stack {
  public readonly alertsTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config, apiName, lambdaFunctions, queues, dlqs } = props;
    const stage = config.stage;

    // ─── SNS Alerts Topic ───

    const alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: `neardeal-alerts-${stage}`,
      displayName: `NearDeal ${stage} Alerts`,
    });

    this.alertsTopic = alertsTopic;

    // ─── CloudWatch Dashboard ───

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `NearDeal-${stage}-Operations`,
    });

    // API Gateway metrics row
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway - Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: { ApiName: apiName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway - Latency & Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: apiName },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: { ApiName: apiName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: { ApiName: apiName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
    );

    // Lambda metrics row
    if (lambdaFunctions.length > 0) {
      const invocationMetrics = lambdaFunctions.map((fn) =>
        fn.metricInvocations({ period: cdk.Duration.minutes(5) }),
      );
      const errorMetrics = lambdaFunctions.map((fn) =>
        fn.metricErrors({ period: cdk.Duration.minutes(5) }),
      );
      const durationMetrics = lambdaFunctions.map((fn) =>
        fn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p95' }),
      );

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Lambda - Invocations',
          left: invocationMetrics,
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lambda - Errors',
          left: errorMetrics,
          width: 8,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lambda - Duration (p95)',
          left: durationMetrics,
          width: 8,
        }),
      );
    }

    // SQS metrics row
    if (queues.length > 0) {
      const sqsVisibleMetrics = queues.map((q) =>
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: { QueueName: q.queueName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
      );

      const sqsSentMetrics = queues.map((q) =>
        new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'NumberOfMessagesSent',
          dimensionsMap: { QueueName: q.queueName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
      );

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'SQS - Messages Visible',
          left: sqsVisibleMetrics,
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'SQS - Messages Sent',
          left: sqsSentMetrics,
          width: 12,
        }),
      );
    }

    // ─── CloudWatch Alarms ───

    // DLQ alarms: alert if any messages land in a DLQ
    for (const dlq of dlqs) {
      const alarm = new cloudwatch.Alarm(this, `DLQAlarm-${dlq.node.id}`, {
        alarmName: `neardeal-${stage}-dlq-${dlq.queueName}`,
        alarmDescription: `Messages detected in DLQ: ${dlq.queueName}`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/SQS',
          metricName: 'ApproximateNumberOfMessagesVisible',
          dimensionsMap: { QueueName: dlq.queueName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new cw_actions.SnsAction(alertsTopic));
      alarm.addOkAction(new cw_actions.SnsAction(alertsTopic));
    }

    // Lambda error rate alarms: alert if error rate > 5%
    for (const fn of lambdaFunctions) {
      const errorRateAlarm = new cloudwatch.Alarm(this, `LambdaErrorAlarm-${fn.node.id}`, {
        alarmName: `neardeal-${stage}-lambda-errors-${fn.functionName}`,
        alarmDescription: `Error rate > 5% for Lambda: ${fn.functionName}`,
        metric: new cloudwatch.MathExpression({
          expression: '(errors / invocations) * 100',
          usingMetrics: {
            errors: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
            invocations: fn.metricInvocations({ period: cdk.Duration.minutes(5) }),
          },
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      errorRateAlarm.addAlarmAction(new cw_actions.SnsAction(alertsTopic));
      errorRateAlarm.addOkAction(new cw_actions.SnsAction(alertsTopic));
    }

    // Note: X-Ray tracing is enabled per-Lambda in the ApiStack via the `tracing` property.

    // ─── Exports ───

    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: alertsTopic.topicArn,
      exportName: `NearDeal-${stage}-AlertsTopicArn`,
    });
  }
}

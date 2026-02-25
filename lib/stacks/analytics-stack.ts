import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { StageConfig } from '../config/stage-config';

interface AnalyticsStackProps extends cdk.StackProps {
  config: StageConfig;
  table: dynamodb.ITable;
}

/**
 * AnalyticsStack — Placeholder for future analytics pipeline resources.
 *
 * Current analytics processing (real-time aggregation) lives in the
 * NotificationStack via the analytics aggregation Lambda + SQS queue.
 *
 * Deal expiry analytics cleanup is handled by the BillingStack via
 * DynamoDB Streams.
 *
 * Future additions to this stack:
 * - Kinesis Data Firehose for streaming raw events to S3
 * - Athena workgroup + Glue catalog for ad-hoc querying
 * - QuickSight dataset integration
 * - S3 bucket for analytics data lake (partitioned by date/city)
 * - Kinesis Data Analytics for real-time anomaly detection
 */
export class AnalyticsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // Tag the stack for cost tracking
    cdk.Tags.of(this).add('Service', 'NearDeal-Analytics');
    cdk.Tags.of(this).add('Stage', stage);

    // Future: Kinesis Data Firehose delivery stream
    // Future: S3 bucket for analytics data lake
    // Future: Glue catalog database and tables
    // Future: Athena workgroup for business intelligence queries
  }
}

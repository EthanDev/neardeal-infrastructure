import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as location from 'aws-cdk-lib/aws-location';
import { Construct } from 'constructs';
import { StageConfig } from '../config/stage-config';

interface LocationStackProps extends cdk.StackProps {
  config: StageConfig;
  table: dynamodb.ITable;
}

export class LocationStack extends cdk.Stack {
  public readonly geofenceCollectionName: string;
  public readonly geofenceEventsQueue: sqs.IQueue;

  constructor(scope: Construct, id: string, props: LocationStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // ─── Amazon Location Service Geofence Collection ───

    const geofenceCollection = new location.CfnGeofenceCollection(this, 'BusinessGeofences', {
      collectionName: `neardeal-businesses-${stage}`,
      description: `Geofence collection for NearDeal business locations (${stage})`,
    });

    this.geofenceCollectionName = geofenceCollection.collectionName;

    // ─── Geofence Events Queue (local to this stack to avoid circular deps) ───

    const geofenceDlq = new sqs.Queue(this, 'GeofenceEventsDLQ', {
      queueName: `neardeal-geofence-events-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.geofenceEventsQueue = new sqs.Queue(this, 'GeofenceEventsQueue', {
      queueName: `neardeal-geofence-events-${stage}`,
      deadLetterQueue: { queue: geofenceDlq, maxReceiveCount: 3 },
    });

    // ─── EventBridge Rule: Geofence ENTER → local queue ───

    const geofenceEnterRule = new events.Rule(this, 'GeofenceEnterRule', {
      ruleName: `neardeal-geofence-enter-${stage}`,
      description: 'Routes Location Service geofence ENTER events to geofence events queue',
      eventPattern: {
        source: ['aws.geo'],
        detailType: ['Location Geofence Event'],
        detail: {
          EventType: ['ENTER'],
          GeofenceCollection: [geofenceCollection.collectionName],
        },
      },
    });

    geofenceEnterRule.addTarget(new targets.SqsQueue(this.geofenceEventsQueue));

    // ─── Exports ───

    new cdk.CfnOutput(this, 'GeofenceCollectionName', {
      value: geofenceCollection.collectionName,
      exportName: `NearDeal-${stage}-GeofenceCollectionName`,
    });
  }
}

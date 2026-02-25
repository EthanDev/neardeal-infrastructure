import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StageConfig } from './config/stage-config';
import { AuthStack } from './stacks/auth-stack';
import { DatabaseStack } from './stacks/database-stack';
import { SecretsStack } from './stacks/secrets-stack';
import { StaticStack } from './stacks/static-stack';
import { ApiStack } from './stacks/api-stack';
import { NotificationStack } from './stacks/notification-stack';
import { LocationStack } from './stacks/location-stack';
import { BillingStack } from './stacks/billing-stack';
import { AnalyticsStack } from './stacks/analytics-stack';
import { MonitoringStack } from './stacks/monitoring-stack';
import { HostingStack } from './stacks/hosting-stack';

interface NearDealStageProps extends cdk.StageProps {
  config: StageConfig;
}

export class NearDealStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: NearDealStageProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // ── 1. DatabaseStack ───────────────────────────────────────────────
    const databaseStack = new DatabaseStack(this, `NearDeal-Database-${stage}`, {
      config,
    });

    // ── 2. AuthStack ─────────────────────────────────────────────────────
    const authStack = new AuthStack(this, `NearDeal-Auth-${stage}`, {
      config,
      table: databaseStack.table,
    });
    authStack.addDependency(databaseStack);

    // ── 3. SecretsStack ──────────────────────────────────────────────────
    const secretsStack = new SecretsStack(this, `NearDeal-Secrets-${stage}`, {
      config,
    });

    // ── 4. StaticStack ───────────────────────────────────────────────────
    const staticStack = new StaticStack(this, `NearDeal-Static-${stage}`, {
      config,
    });

    // ── 5. ApiStack (depends on Auth, Database, Secrets) ─────────────────
    const apiStack = new ApiStack(this, `NearDeal-Api-${stage}`, {
      config,
      table: databaseStack.table,
      vpc: databaseStack.vpc,
      redisSecurityGroup: databaseStack.redisSecurityGroup,
      redisEndpoint: databaseStack.redisEndpoint,
      redisPort: databaseStack.redisPort,
      consumerUserPool: authStack.consumerUserPool,
      consumerUserPoolClient: authStack.consumerUserPoolClient,
      businessUserPool: authStack.businessUserPool,
      businessUserPoolClient: authStack.businessUserPoolClient,
      qrHmacSecret: secretsStack.qrHmacSecret,
      stripeWebhookSecret: secretsStack.stripeWebhookSecret,
    });
    apiStack.addDependency(authStack);
    apiStack.addDependency(databaseStack);
    apiStack.addDependency(secretsStack);

    // ── 6. NotificationStack (depends on Database) ───────────────────────
    const notificationStack = new NotificationStack(this, `NearDeal-Notification-${stage}`, {
      config,
      table: databaseStack.table,
      vpc: databaseStack.vpc,
      redisSecurityGroup: databaseStack.redisSecurityGroup,
      redisEndpoint: databaseStack.redisEndpoint,
      redisPort: databaseStack.redisPort,
    });
    notificationStack.addDependency(databaseStack);

    // ── 7. LocationStack (depends on Database, Notification) ─────────────
    const locationStack = new LocationStack(this, `NearDeal-Location-${stage}`, {
      config,
      table: databaseStack.table,
    });
    locationStack.addDependency(databaseStack);

    // ── 8. BillingStack (depends on Database) ────────────────────────────
    const billingStack = new BillingStack(this, `NearDeal-Billing-${stage}`, {
      config,
      table: databaseStack.table,
      vpc: databaseStack.vpc,
      redisSecurityGroup: databaseStack.redisSecurityGroup,
      redisEndpoint: databaseStack.redisEndpoint,
      redisPort: databaseStack.redisPort,
    });
    billingStack.addDependency(databaseStack);

    // ── 9. AnalyticsStack (placeholder) ──────────────────────────────────
    const analyticsStack = new AnalyticsStack(this, `NearDeal-Analytics-${stage}`, {
      config,
      table: databaseStack.table,
    });
    analyticsStack.addDependency(databaseStack);

    // ── 10. MonitoringStack (depends on all) ─────────────────────────────
    const monitoringStack = new MonitoringStack(this, `NearDeal-Monitoring-${stage}`, {
      config,
      apiName: `neardeal-api-${stage}`,
      lambdaFunctions: [], // Populated at deploy time via CDK outputs if needed
      queues: [
        notificationStack.dealsQueue,
        notificationStack.analyticsQueue,
        notificationStack.businessAlertsQueue,
      ],
      dlqs: [], // DLQs are internal to NotificationStack; alarms are set there or via metric filters
    });
    monitoringStack.addDependency(authStack);
    monitoringStack.addDependency(databaseStack);
    monitoringStack.addDependency(secretsStack);
    monitoringStack.addDependency(staticStack);
    monitoringStack.addDependency(apiStack);
    monitoringStack.addDependency(notificationStack);
    monitoringStack.addDependency(locationStack);
    monitoringStack.addDependency(billingStack);

    // ── 11. HostingStack (depends on Api, Static) ────────────────────────
    const hostingStack = new HostingStack(this, `NearDeal-Hosting-${stage}`, {
      config,
      apiUrl: apiStack.httpApi.apiEndpoint,
      wsApiUrl: `wss://${apiStack.webSocketApi.apiId}.execute-api.${config.region}.amazonaws.com/${stage}`,
      cdnUrl: staticStack.distribution ? `https://${staticStack.distribution.distributionDomainName}` : `https://${config.cdnDomain}`,
    });
    hostingStack.addDependency(apiStack);
    hostingStack.addDependency(staticStack);
  }
}

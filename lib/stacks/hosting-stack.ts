import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { StageConfig } from '../config/stage-config';

interface HostingStackProps extends cdk.StackProps {
  config: StageConfig;
  apiUrl: string;
  wsApiUrl: string;
  cdnUrl: string;
}

export class HostingStack extends cdk.Stack {
  public readonly consumerApp: amplify.CfnApp;
  public readonly businessApp: amplify.CfnApp;

  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, props);

    const { config, apiUrl, wsApiUrl, cdnUrl } = props;
    const stage = config.stage;

    const githubToken = secretsmanager.Secret.fromSecretNameV2(this, 'GitHubToken', 'neardeal/github-token');

    const nextjsBuildSpec = `
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
`;

    // ──────────────────────────────────────────────
    // Consumer App (app.{domain})
    // ──────────────────────────────────────────────
    this.consumerApp = new amplify.CfnApp(this, 'ConsumerApp', {
      name: `neardeal-consumer-${stage}`,
      repository: 'https://github.com/EthanDev/neardeal-consumer',
      oauthToken: githubToken.secretValue.unsafeUnwrap(),
      platform: 'WEB_COMPUTE',
      buildSpec: nextjsBuildSpec,
      environmentVariables: [
        { name: 'NEXT_PUBLIC_API_URL', value: apiUrl },
        { name: 'NEXT_PUBLIC_WS_URL', value: wsApiUrl },
        { name: 'NEXT_PUBLIC_CDN_URL', value: cdnUrl },
      ],
      customRules: [
        {
          source: '/<*>',
          target: '/index.html',
          status: '404-200',
        },
      ],
    });

    const consumerBranch = new amplify.CfnBranch(this, 'ConsumerMainBranch', {
      appId: this.consumerApp.attrAppId,
      branchName: 'main',
      enableAutoBuild: true,
      stage: 'PRODUCTION',
      environmentVariables: [
        { name: 'NEXT_PUBLIC_API_URL', value: apiUrl },
        { name: 'NEXT_PUBLIC_WS_URL', value: wsApiUrl },
        { name: 'NEXT_PUBLIC_CDN_URL', value: cdnUrl },
      ],
    });


    // ──────────────────────────────────────────────
    // Business App (business.{domain})
    // ──────────────────────────────────────────────
    this.businessApp = new amplify.CfnApp(this, 'BusinessApp', {
      name: `neardeal-business-${stage}`,
      repository: 'https://github.com/EthanDev/neardeal-business',
      oauthToken: githubToken.secretValue.unsafeUnwrap(),
      platform: 'WEB_COMPUTE',
      buildSpec: nextjsBuildSpec,
      environmentVariables: [
        { name: 'NEXT_PUBLIC_API_URL', value: apiUrl },
        { name: 'NEXT_PUBLIC_WS_URL', value: wsApiUrl },
        { name: 'NEXT_PUBLIC_CDN_URL', value: cdnUrl },
        { name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', value: 'pk_test_PLACEHOLDER' },
      ],
      customRules: [
        {
          source: '/<*>',
          target: '/index.html',
          status: '404-200',
        },
      ],
    });

    const businessBranch = new amplify.CfnBranch(this, 'BusinessMainBranch', {
      appId: this.businessApp.attrAppId,
      branchName: 'main',
      enableAutoBuild: true,
      stage: 'PRODUCTION',
      environmentVariables: [
        { name: 'NEXT_PUBLIC_API_URL', value: apiUrl },
        { name: 'NEXT_PUBLIC_WS_URL', value: wsApiUrl },
        { name: 'NEXT_PUBLIC_CDN_URL', value: cdnUrl },
        { name: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', value: 'pk_test_PLACEHOLDER' },
      ],
    });


    // ──────────────────────────────────────────────
    // Outputs
    // ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ConsumerAppId', {
      value: this.consumerApp.attrAppId,
      exportName: `NearDeal-${stage}-ConsumerAmplifyAppId`,
    });

    new cdk.CfnOutput(this, 'BusinessAppId', {
      value: this.businessApp.attrAppId,
      exportName: `NearDeal-${stage}-BusinessAmplifyAppId`,
    });

    new cdk.CfnOutput(this, 'ConsumerAppUrl', {
      value: `https://app.${config.domainName}`,
    });

    new cdk.CfnOutput(this, 'BusinessAppUrl', {
      value: `https://business.${config.domainName}`,
    });
  }
}

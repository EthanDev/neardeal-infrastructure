import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { NearDealStage } from '../neardeal-stage';
import { stageConfigs } from '../config/stage-config';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Pipeline source & synth ──────────────────────────────────────────
    const pipeline = new pipelines.CodePipeline(this, 'NearDealPipeline', {
      pipelineName: 'NearDeal-Pipeline',
      crossAccountKeys: true,
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection(
          'EthanDev/neardeal-infrastructure',
          'main',
          {
            connectionArn:
              'arn:aws:codestar-connections:eu-west-1:313451567774:connection/d4d4f475-a1bb-43ea-94bd-a0e580c0beea',
          },
        ),
        commands: [
          'cd infrastructure',
          'npm ci',
          'npx cdk synth',
        ],
        primaryOutputDirectory: 'infrastructure/cdk.out',
      }),
    });

    // ── Staging stage ────────────────────────────────────────────────────
    const stagingConfig = stageConfigs.staging;
    const stagingStage = new NearDealStage(this, 'Staging', {
      config: stagingConfig,
      env: {
        account: stagingConfig.account,
        region: stagingConfig.region,
      },
    });
    pipeline.addStage(stagingStage);

    // ── Production stage (with manual approval) ──────────────────────────
    const prodConfig = stageConfigs.prod;
    const prodStage = new NearDealStage(this, 'Production', {
      config: prodConfig,
      env: {
        account: prodConfig.account,
        region: prodConfig.region,
      },
    });
    pipeline.addStage(prodStage, {
      pre: [
        new pipelines.ManualApprovalStep('PromoteToProd', {
          comment: 'Review staging deployment before promoting to production.',
        }),
      ],
    });
  }
}

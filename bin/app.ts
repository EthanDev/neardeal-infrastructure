#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Stage, stageConfigs } from '../lib/config/stage-config';
import { NearDealStage } from '../lib/neardeal-stage';
import { PipelineStack } from '../lib/stacks/pipeline-stack';

const app = new cdk.App();

// Determine stage from context or environment
const stage = (app.node.tryGetContext('stage') as Stage) || 'dev';
const config = stageConfigs[stage];

if (!config) {
  throw new Error(`Unknown stage: ${stage}. Must be one of: dev, staging, prod`);
}

const env = {
  account: config.account,
  region: config.region,
};

// ── Direct deployment mode (cdk deploy --all -c stage=<stage>) ──
new NearDealStage(app, `NearDeal-${stage}`, {
  config,
  env,
});

// ── Pipeline mode (deploys staging + prod automatically) ──
new PipelineStack(app, 'NearDeal-Pipeline', { env });

app.synth();

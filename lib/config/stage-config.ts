export type Stage = 'dev' | 'staging' | 'prod';

export interface StageConfig {
  stage: Stage;
  account: string;
  region: string;
  domainName: string;
  cdnDomain: string;
  consumerAppDomain: string;
  businessAppDomain: string;
  redis: {
    nodeType: string;
    numCacheNodes: number;
  };
  lambda: {
    nearbyDealsProvisionedConcurrency: number;
    createClaimProvisionedConcurrency: number;
  };
  apiThrottling: {
    rateLimit: number;
    burstLimit: number;
  };
}

const baseConfig = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '000000000000',
  region: 'eu-west-1',
};

export const stageConfigs: Record<Stage, StageConfig> = {
  dev: {
    ...baseConfig,
    stage: 'dev',
    domainName: 'dev.neardeal.ro',
    cdnDomain: 'cdn.dev.neardeal.ro',
    consumerAppDomain: 'app.dev.neardeal.ro',
    businessAppDomain: 'business.dev.neardeal.ro',
    redis: {
      nodeType: 'cache.t3.medium',
      numCacheNodes: 1,
    },
    lambda: {
      nearbyDealsProvisionedConcurrency: 0,
      createClaimProvisionedConcurrency: 0,
    },
    apiThrottling: {
      rateLimit: 100,
      burstLimit: 200,
    },
  },
  staging: {
    ...baseConfig,
    stage: 'staging',
    domainName: 'staging.neardeal.ro',
    cdnDomain: 'cdn.staging.neardeal.ro',
    consumerAppDomain: 'app.staging.neardeal.ro',
    businessAppDomain: 'business.staging.neardeal.ro',
    redis: {
      nodeType: 'cache.t3.medium',
      numCacheNodes: 1,
    },
    lambda: {
      nearbyDealsProvisionedConcurrency: 2,
      createClaimProvisionedConcurrency: 1,
    },
    apiThrottling: {
      rateLimit: 100,
      burstLimit: 200,
    },
  },
  prod: {
    ...baseConfig,
    stage: 'prod',
    domainName: 'neardeal.ro',
    cdnDomain: 'cdn.neardeal.ro',
    consumerAppDomain: 'app.neardeal.ro',
    businessAppDomain: 'business.neardeal.ro',
    redis: {
      nodeType: 'cache.r6g.large',
      numCacheNodes: 1,
    },
    lambda: {
      nearbyDealsProvisionedConcurrency: 5,
      createClaimProvisionedConcurrency: 3,
    },
    apiThrottling: {
      rateLimit: 100,
      burstLimit: 200,
    },
  },
};

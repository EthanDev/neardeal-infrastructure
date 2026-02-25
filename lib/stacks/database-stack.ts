import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { StageConfig } from '../config/stage-config';

interface DatabaseStackProps extends cdk.StackProps {
  config: StageConfig;
}

export class DatabaseStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly vpc: ec2.Vpc;
  public readonly redisSecurityGroup: ec2.SecurityGroup;
  public readonly redisEndpoint: string;
  public readonly redisPort: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // ─── DynamoDB Table ───

    this.table = new dynamodb.Table(this, 'MainTable', {
      tableName: `neardeal-main-${stage}`,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAt',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: active deals by expiry (status → expiresAt)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI2: deals by business (businessId → createdAt)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI3: user claim history (userId → claimedAt)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
    });

    // GSI4: referral lookup (referralCode, no sort key)
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: { name: 'GSI4PK', type: dynamodb.AttributeType.STRING },
    });

    // ─── VPC ───

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `neardeal-vpc-${stage}`,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ─── ElastiCache Redis ───

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `neardeal-redis-sg-${stage}`,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: true,
    });

    this.redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from within VPC',
    );

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      cacheSubnetGroupName: `neardeal-redis-subnet-${stage}`,
      description: `Redis subnet group for ${stage}`,
      subnetIds: this.vpc.privateSubnets.map((s) => s.subnetId),
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      clusterName: `neardeal-redis-${stage}`,
      engine: 'redis',
      cacheNodeType: config.redis.nodeType,
      numCacheNodes: config.redis.numCacheNodes,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [this.redisSecurityGroup.securityGroupId],
    });

    redisCluster.addDependency(redisSubnetGroup);

    this.redisEndpoint = redisCluster.attrRedisEndpointAddress;
    this.redisPort = redisCluster.attrRedisEndpointPort;
  }
}

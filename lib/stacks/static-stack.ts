import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { StageConfig } from '../config/stage-config';

interface StaticStackProps extends cdk.StackProps {
  config: StageConfig;
}

export class StaticStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution?: cloudfront.Distribution;
  public readonly hostedZone?: route53.HostedZone;

  constructor(scope: Construct, id: string, props: StaticStackProps) {
    super(scope, id, props);

    const { stage, domainName } = props.config;
    const isProd = stage === 'prod';

    // ── S3 bucket ──────────────────────────────────────────────────────
    this.bucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `neardeal-assets-${stage}`,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['https://*.neardeal.ro'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    // ── CloudFront distribution ──────────────────────────────────────
    // BLOCKED: AWS account must be verified before creating CloudFront resources.
    // Contact AWS Support to verify, then uncomment this block.
    // this.distribution = new cloudfront.Distribution(this, 'AssetsDistribution', {
    //   defaultBehavior: {
    //     origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
    //     allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
    //     cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
    //     viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    //     cachePolicy: new cloudfront.CachePolicy(this, 'AssetsCachePolicy', {
    //       defaultTtl: cdk.Duration.days(7),
    //       maxTtl: cdk.Duration.days(30),
    //       minTtl: cdk.Duration.seconds(0),
    //     }),
    //   },
    //   priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    // });

    // ── Route 53 hosted zone (prod only) ───────────────────────────────
    if (isProd) {
      this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
        zoneName: domainName,
      });
    }
  }
}

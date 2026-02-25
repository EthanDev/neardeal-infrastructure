import * as cdk from 'aws-cdk-lib/core';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { StageConfig } from '../config/stage-config';

interface SecretsStackProps extends cdk.StackProps {
  config: StageConfig;
}

export class SecretsStack extends cdk.Stack {
  public readonly qrHmacSecret: secretsmanager.Secret;
  public readonly stripeWebhookSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const { stage } = props.config;

    // QR HMAC secret — auto-generated
    this.qrHmacSecret = new secretsmanager.Secret(this, 'QrHmacSecret', {
      secretName: `neardeal/${stage}/qr-hmac-secret`,
      description: 'HMAC secret used for QR code signing',
      generateSecretString: {
        excludePunctuation: false,
        passwordLength: 64,
      },
      // Rotation requires a Lambda — add rotation Lambda here later
      // this.qrHmacSecret.addRotationSchedule('QrHmacRotation', {
      //   automaticallyAfter: cdk.Duration.days(90),
      //   rotationLambda: rotationFn,
      // });
    });

    // Stripe webhook secret — placeholder value
    this.stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
      secretName: `neardeal/${stage}/stripe-webhook-secret`,
      description: 'Stripe webhook signing secret',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER_REPLACE_ME'),
    });
  }
}

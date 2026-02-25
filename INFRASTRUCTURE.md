# NearDeal Infrastructure Documentation

> Comprehensive reference for the NearDeal AWS CDK infrastructure. All backend services run in **eu-west-1** on a single AWS account resolved from `CDK_DEFAULT_ACCOUNT`.

---

## Table of Contents

1. [Stage Configuration](#1-stage-configuration)
2. [Authentication](#2-authentication)
3. [Database & Caching](#3-database--caching)
4. [Secrets Management](#4-secrets-management)
5. [API Reference](#5-api-reference)
6. [Lambda Handlers](#6-lambda-handlers)
7. [WebSocket API](#7-websocket-api)
8. [Notifications](#8-notifications)
9. [Location Services](#9-location-services)
10. [Billing & Plan Enforcement](#10-billing--plan-enforcement)
11. [Analytics](#11-analytics)
12. [Monitoring & Observability](#12-monitoring--observability)
13. [Hosting](#13-hosting)
14. [Static Assets & CDN](#14-static-assets--cdn)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Stack Dependencies](#16-stack-dependencies)
17. [Security](#17-security)
18. [DynamoDB Access Patterns](#18-dynamodb-access-patterns)
19. [Redis Key Patterns](#19-redis-key-patterns)
20. [Deployment](#20-deployment)
21. [Cost Estimate](#21-cost-estimate)

---

## 1. Stage Configuration

Three stages are defined in `stage-config.ts`. All stages deploy to **eu-west-1**.

| Setting | Dev | Staging | Prod |
|---------|-----|---------|------|
| Domain | dev.neardeal.ro | staging.neardeal.ro | neardeal.ro |
| CDN Domain | cdn.dev.neardeal.ro | cdn.staging.neardeal.ro | cdn.neardeal.ro |
| Redis Instance | cache.t3.medium | cache.t3.medium | cache.r6g.large |
| Redis Nodes | 1 | 1 | 1 |
| Provisioned Concurrency -- nearbyDeals | 0 | 2 | 5 |
| Provisioned Concurrency -- createClaim | 0 | 1 | 3 |
| API Throttle Rate | 100 req/s | 100 req/s | 100 req/s |
| API Throttle Burst | 200 | 200 | 200 |

---

## 2. Authentication

Two separate Cognito User Pools isolate consumer and business identities.

### Consumer User Pool -- `neardeal-{stage}-consumer-pool`

- **Sign-in alias:** email
- **Auto-verify:** email
- **Password policy:** minimum 8 characters, require uppercase and digits
- **Token validity:** 1 hour access token, 30 day refresh token
- **Required standard attributes:** email, name
- **Custom attributes:**
  - `preferredCategories` (String)
  - `homeDistrict` (String)
  - `streakCount` (Number)
  - `totalClaims` (Number)
- **Post-confirmation trigger:** `ConsumerPostConfirmationFn`
  - Creates a DynamoDB item: `PK=USER#{sub}`, `SK=PROFILE`
  - Fields: email, name, preferredCategories=[], homeDistrict='', streakCount=0, totalClaims=0
- **Cognito domain:** `neardeal-{stage}-consumer`
- **App client:** `neardeal-{stage}-consumer-client`
  - No client secret
  - Auth flows: USER_PASSWORD_AUTH, USER_SRP_AUTH

### Business User Pool -- `neardeal-{stage}-business-pool`

- Same password and token policies as consumer pool
- **Custom attributes:**
  - `businessId` (String)
  - `planTier` (String)
  - `stripeCustomerId` (String)
  - `monthlyDealCount` (Number)
- **Post-confirmation trigger:** `BusinessPostConfirmationFn`
  - Creates a DynamoDB item: `PK=BUSINESS#{sub}`, `SK=PROFILE`
  - Fields: email, businessName, planTier='free', monthlyDealCount=0, stripeCustomerId=''
- **Cognito domain:** `neardeal-{stage}-business`
- **App client:** `neardeal-{stage}-business-client`
  - No client secret
  - Auth flows: USER_PASSWORD_AUTH, USER_SRP_AUTH

---

## 3. Database & Caching

### DynamoDB -- `neardeal-main-{stage}`

- **Billing mode:** On-demand (PAY_PER_REQUEST)
- **Point-in-time recovery:** Enabled
- **Streams:** NEW_AND_OLD_IMAGES
- **TTL attribute:** `expiresAt`
- **Primary key:** PK (String), SK (String)

**Global Secondary Indexes:**

| GSI | Partition Key | Sort Key | Purpose |
|-----|--------------|----------|---------|
| GSI1 | GSI1PK | GSI1SK | Active deals by expiry, user saves, WebSocket subscriptions by city |
| GSI2 | GSI2PK | GSI2SK | Deals by business (`BIZ#{id}` -> `DEAL#{createdAt}`) |
| GSI3 | GSI3PK | GSI3SK | User claim history (`USER#{id}` -> `CLAIM#{claimedAt}`) |
| GSI4 | GSI4PK | *(none)* | Claim lookup by claimId (`CLAIM#{claimId}`) |

### VPC -- `neardeal-vpc-{stage}`

- 2 Availability Zones
- Public subnets and private subnets with NAT gateway

### Redis (ElastiCache) -- `neardeal-redis-{stage}`

- **Security group:** `neardeal-redis-sg-{stage}`, allows port 6379 from VPC CIDR
- **Subnet group:** `neardeal-redis-subnet-{stage}` (private subnets)
- Instance type varies by stage (see Stage Configuration)

---

## 4. Secrets Management

| Secret | Description |
|--------|-------------|
| `neardeal/{stage}/qr-hmac-secret` | Auto-generated 64-character string used for QR code HMAC-SHA256 signing |
| `neardeal/{stage}/stripe-webhook-secret` | Placeholder value -- must be manually replaced with the real Stripe webhook signing secret |

---

## 5. API Reference

### HTTP API Routes

| Method | Path | Auth | Lambda Handler |
|--------|------|------|----------------|
| POST | /api/deals | Business JWT | CreateDeal |
| GET | /api/deals/nearby | Consumer JWT | GetNearbyDeals |
| GET | /api/deals/flash | Consumer JWT | GetFlashDeal |
| GET | /api/deals/{dealId} | Consumer JWT | GetDeal |
| POST | /api/claims | Consumer JWT | CreateClaim |
| POST | /api/claims/{claimId}/redeem | Business JWT | RedeemClaim |
| GET | /api/business/dashboard | Business JWT | GetDashboard |
| GET | /api/business/analytics | Business JWT | GetAnalytics |
| PUT | /api/consumer/profile | Consumer JWT | UpdateConsumerProfile |
| PUT | /api/business/profile | Business JWT | UpdateBusinessProfile |
| POST | /api/saves/{dealId} | Consumer JWT | ToggleSave |
| GET | /api/saves | Consumer JWT | GetSaves |
| GET | /api/consumer/streak | Consumer JWT | GetStreak |
| GET | /api/consumer/savings | Consumer JWT | GetSavings |
| GET | /api/stats/city | None (public) | GetCityStats |
| POST | /api/webhooks/stripe | None (public) | StripeWebhook |

---

## 6. Lambda Handlers

All Lambdas share the following defaults:

- **Runtime:** Node.js 20.x
- **Memory:** 256 MB (except plan enforcement: 128 MB)
- **Timeout:** 15 seconds (except plan enforcement: 10 seconds)
- **Networking:** VPC private subnets
- **Bundling:** esbuild with minification and source maps, external modules: `@aws-sdk/*`

### CreateDeal

Business creates a deal with title, description, pricing, location, and expiration. Generates a UUID `dealId` and an HMAC-SHA256 QR signature using the QR HMAC secret. Writes `DEAL#{dealId}:META` to DynamoDB. Runs `GEOADD` on `geo:deals:{city}` in Redis. Caches the deal JSON at `deal:{dealId}`. Optionally handles flash deals with a separate TTL in Redis. Increments `stats:deals:{city}`.

### GetNearbyDeals

Runs `GEORADIUS` on `geo:deals:{city}` within the requested radius (in km). Pipeline-checks `deal:{dealId}` in Redis for cached data. Falls back to DynamoDB `BatchGetItem` for cache misses. Filters results: must be active, not expired, have remaining claims, and optionally match a category. Sorts results by distance from the querying consumer.

### GetFlashDeal

Scans `flash:{city}:*` Redis keys for active flash deals. Falls back to a GSI1 query for active flash deals if Redis has no results.

### GetDeal

Checks Redis cache at `deal:{dealId}` first, falls back to DynamoDB. Adds `isSaved` and `hasClaimed` boolean flags via parallel queries against the consumer's save and claim records.

### CreateClaim

Validates that the deal is active, not expired, and has remaining capacity. Prevents duplicate claims via a DynamoDB conditional write. Generates a `claimId` and an HMAC redemption code. Writes `DEAL#{dealId}:CLAIM#{userId}` with `GSI3PK`, `GSI3SK`, and `GSI4PK` attributes. Atomically increments the deal's `claimCount` and the user's `totalClaims`. Invalidates the deal cache in Redis.

### RedeemClaim

Looks up the claim via GSI4 (`CLAIM#{claimId}`). Verifies business ownership of the deal. Verifies the HMAC signature on the redemption code. Updates the claim status to `redeemed` with a conditional check to prevent replay attacks. Increments the user's streak count. Increments `biz:{businessId}:redemptions` in Redis.

### GetDashboard

Fetches the business profile and all deals via GSI2. Separates deals into active and expired buckets. Calculates summary totals (total deals, total claims, total redemptions).

### GetAnalytics

Supports configurable time periods: 7 days, 30 days, or 90 days. Aggregates data by category and by day. Shows top-performing deals with conversion rates (claims / views).

### GetStreak

Checks whether the consumer's streak is active (last redemption within 7 days). Returns current streak count and milestone information. Milestones at: 5, 10, 25, 50, 100 redemptions.

### GetSavings

Calculates the consumer's total savings (original price minus discounted price across all redeemed deals). Aggregates savings by category and by month.

### UpdateConsumerProfile

Allowed fields: `name`, `preferredCategories`, `homeDistrict`, `avatarUrl`, `notificationsEnabled`.

### UpdateBusinessProfile

Allowed fields: `businessName`, `address`, `district`, `city`, `phone`, `website`, `description`, `logoUrl`, `coverImageUrl`, `categories`, `openingHours`, `latitude`, `longitude`.

### ToggleSave

Verifies that the deal exists. If the consumer has already saved the deal, deletes the save record. If not, creates a save record with GSI1 indexing for efficient retrieval.

### GetSaves

Queries GSI1 for `USER#{userId}#SAVES`. Supports pagination with base64url-encoded `nextToken`. Batch-fetches deal details for all saved deals.

### GetCityStats

Public endpoint (no auth required). Cached in Redis at `stats:city:{city}` with a 5-minute TTL. Returns: `totalDealsCreated`, `totalClaims`, `totalRedemptions`, `activeDeals`, `geoIndexedDeals`.

### StripeWebhook

Verifies the Stripe webhook signature using HMAC-SHA256 with timing-safe comparison and a 5-minute tolerance window. Handles the following events:

- `checkout.session.completed` -- provisions the subscription
- `customer.subscription.updated` -- updates the plan tier
- `customer.subscription.deleted` -- downgrades to free
- `invoice.payment_failed` -- flags the account

---

## 7. WebSocket API

| Route | Lambda | Behavior |
|-------|--------|----------|
| `$connect` | WsConnect | Stores `WS#{connectionId}:CONNECTION` in DynamoDB with a 24-hour TTL |
| `$disconnect` | WsDisconnect | Deletes the connection record from DynamoDB |
| `$default` | WsDefault | Handles `ping` (responds with pong + timestamp) and `subscribe` (subscribes to city-level deal updates) |

---

## 8. Notifications

### SQS Queues

| Queue | Type | Visibility | DLQ | DLQ Retention | Max Retries |
|-------|------|-----------|-----|---------------|-------------|
| `neardeal-deals-{stage}.fifo` | FIFO (content-based dedup) | 60s | `neardeal-deals-dlq-{stage}.fifo` | 14 days | 3 |
| `neardeal-analytics-{stage}` | Standard | 60s | `neardeal-analytics-dlq-{stage}` | 14 days | 3 |
| `neardeal-business-alerts-{stage}` | Standard | 60s | `neardeal-business-alerts-dlq-{stage}` | 14 days | 3 |

### Fan-Out Lambda -- `neardeal-notification-fanout-{stage}`

- Triggered by the deals FIFO queue with a batch size of 5
- Runs `GEORADIUS` at 5 km to find nearby consumers
- Filters consumers by category preferences
- Throttles notifications to 1 per consumer per hour
- Writes notification records: `PK=USER#{consumerId}`, `SK=NOTIF#{timestamp}#{notifId}`

### SES

- Sender identity: `notifications-{stage}@neardeal.ro`

---

## 9. Location Services

- **Geofence collection:** `neardeal-businesses-{stage}`
- **EventBridge rule:** `neardeal-geofence-enter-{stage}` -- routes `aws.geo` ENTER events to a local SQS queue
- **Queue:** `neardeal-geofence-events-{stage}` with DLQ `neardeal-geofence-events-dlq-{stage}`
- **Geofence processing Lambda** handles inbound location events

---

## 10. Billing & Plan Enforcement

### Plan Tiers

| Tier | Deals/Month | Max Active | Flash Deals |
|------|-------------|-----------|-------------|
| Free | 5 | 2 | No |
| Starter | 20 | 10 | No |
| Pro | 100 | 50 | Yes |
| Enterprise | Unlimited | Unlimited | Yes |

### Plan Enforcement Lambda -- `neardeal-plan-enforcement-{stage}`

- **Memory:** 128 MB
- **Timeout:** 10 seconds
- Queries GSI2 for the business's monthly deal count and active deal count
- Enforces limits based on the plan tier
- **Fails open** on errors (allows the operation if enforcement itself fails)

### Deal Expiry Lambda -- `neardeal-deal-expiry-{stage}`

- Triggered by DynamoDB Streams (REMOVE events from TTL expiration)
- Batch size: 10, max retries: 3, bisect batch on error
- Cleanup actions:
  - Redis: `ZREM` from the geo key, `DEL` deal cache, `DEL` flash key, `DECR` stats counter
  - Creates a `DEAL_EXPIRED` notification for the business owner
  - Writes a final analytics summary to DynamoDB

---

## 11. Analytics

### Analytics Aggregation Lambda -- `neardeal-analytics-aggregate-{stage}`

- Triggered by the analytics SQS queue with a batch size of 10
- Processes event types: `deal_view`, `deal_claim`, `deal_share`, `deal_expire`, `search`
- **Redis counters:**
  - `analytics:daily:{YYYY-MM-DD}` -- daily totals
  - `analytics:biz:{businessId}:{YYYY-MM-DD}` -- per-business daily (30-day TTL)
  - `analytics:deal:{dealId}` -- deal lifetime totals
- **DynamoDB records:**
  - `BIZ#{businessId}/ANALYTICS#{date}#{type}`
  - `DEAL#{dealId}/ANALYTICS#{type}`

### Future Planned (Placeholder)

- Kinesis Data Firehose for event streaming
- S3 data lake for raw events
- AWS Glue for ETL
- Amazon Athena for ad-hoc queries
- Amazon QuickSight for dashboards

---

## 12. Monitoring & Observability

### CloudWatch Dashboard -- `NearDeal-{stage}-Operations`

**API Gateway widgets:**
- Total requests
- p99 latency
- 5xx error count
- 4xx error count

**Lambda widgets:**
- Invocation count
- Error count
- p95 duration

**SQS widgets:**
- Approximate visible messages
- Number of messages sent

### CloudWatch Alarms

| Alarm | Condition | Period | Evaluation Periods |
|-------|-----------|--------|-------------------|
| DLQ Messages | > 0 messages visible | 1 minute | 1 |
| Lambda Error Rate | > 5% error rate | 5 minutes | 2 |

### SNS Alert Topic -- `neardeal-alerts-{stage}`

All alarms publish to this topic.

### Tracing

AWS X-Ray tracing is enabled on every Lambda function.

---

## 13. Hosting

### Consumer App -- `neardeal-consumer-{stage}`

- **Repository:** https://github.com/EthanDev/neardeal-consumer
- **Platform:** WEB_COMPUTE (AWS Amplify)
- **Framework:** Next.js
- **Build command:** `npm ci && npm run build`
- **Artifacts:** `.next`
- **Branch:** main (auto-build enabled, PRODUCTION stage)
- **GitHub OAuth token:** sourced from Secrets Manager at `neardeal/github-token`
- **Environment variables:**
  - `NEXT_PUBLIC_API_URL`
  - `NEXT_PUBLIC_WS_URL`
  - `NEXT_PUBLIC_CDN_URL`

### Business App -- `neardeal-business-{stage}`

- **Repository:** https://github.com/EthanDev/neardeal-business
- Same configuration as the consumer app, plus:
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (set to `pk_test_PLACEHOLDER` -- must be replaced)

---

## 14. Static Assets & CDN

### S3 Bucket -- `neardeal-assets-{stage}`

- All public access blocked
- Lifecycle rule: transition to Infrequent Access after 90 days
- CORS: allows GET, PUT, POST from `https://*.neardeal.ro`, exposes `ETag` header
- Removal policy: RETAIN for prod, DESTROY for non-prod stages

### CloudFront

Currently **BLOCKED** -- requires AWS account verification before distribution can be created.

### Route53

Hosted zone for `neardeal.ro` is created in the **prod stage only**.

---

## 15. CI/CD Pipeline

### Pipeline -- `NearDeal-Pipeline`

- **Source:** `EthanDev/neardeal-infrastructure`, main branch
- **CodeStar connection:** `arn:aws:codestar-connections:eu-west-1:313451567774:connection/d4d4f475-a1bb-43ea-94bd-a0e580c0beea`
- **Synth command:** `cd infrastructure && npm ci && npx cdk synth`
- **Cross-account keys:** Enabled

### Pipeline Stages

1. **Source** -- pulls from GitHub on push to main
2. **Build/Synth** -- synthesizes CloudFormation templates
3. **Staging** -- deploys automatically
4. **Manual Approval** -- gate named `PromoteToProd`
5. **Production** -- deploys after approval

---

## 16. Stack Dependencies

```
DatabaseStack ---+---> AuthStack ---> ApiStack ---+---> HostingStack
                 |                                |
SecretsStack ----+                                |
                                                  |
StaticStack --------------------------------------+

DatabaseStack ---> NotificationStack
DatabaseStack ---> LocationStack
DatabaseStack ---> BillingStack
DatabaseStack ---> AnalyticsStack

All Stacks ---> MonitoringStack
```

---

## 17. Security

### Network Isolation

- **VPC** with public and private subnets across 2 AZs
- **NAT Gateway** in public subnets provides outbound internet for private subnets
- **Redis** runs exclusively in private subnets, accessible only from within the VPC CIDR on port 6379
- **All Lambda functions** execute in VPC private subnets

### S3 Security

- All public access is blocked at the bucket level
- Access is granted only through CloudFront OAI (when enabled) or signed URLs

### Authentication & Authorization

- Consumer and business APIs are protected by **Cognito JWT authorizers** on the HTTP API Gateway
- Two separate user pools ensure consumer and business tokens cannot be used interchangeably

### QR Code HMAC Verification Flow

1. When a deal is created, the server generates an HMAC-SHA256 signature of the `dealId` using the QR HMAC secret stored in Secrets Manager
2. The signature is embedded in the QR code issued with each claim
3. At redemption time, the `RedeemClaim` handler recomputes the HMAC and compares it to the presented code
4. This prevents forgery of redemption codes without access to the server-side secret

### Stripe Webhook Verification

- Incoming webhook payloads are verified using HMAC-SHA256 with the Stripe webhook signing secret
- Comparison uses **timing-safe** equality to prevent timing attacks
- Requests older than **5 minutes** are rejected to prevent replay attacks

### IAM

- Lambda functions are granted **least-privilege** access via CDK's `grantReadWriteData` helpers rather than broad wildcard policies
- Each function receives only the permissions it needs (DynamoDB table access, SQS send/receive, Secrets Manager read, etc.)

---

## 18. DynamoDB Access Patterns

| Access Pattern | Key Condition | Index |
|----------------|--------------|-------|
| Get user profile | PK=`USER#{id}`, SK=`PROFILE` | Table |
| Get business profile | PK=`BUSINESS#{id}`, SK=`PROFILE` | Table |
| Get deal metadata | PK=`DEAL#{dealId}`, SK=`META` | Table |
| Get deal claims | PK=`DEAL#{dealId}`, SK begins_with `CLAIM#` | Table |
| Active deals by expiry | GSI1PK=`ACTIVE_DEALS`, GSI1SK=expiresAt | GSI1 |
| User saves | GSI1PK=`USER#{id}#SAVES`, GSI1SK=savedAt | GSI1 |
| WebSocket subscriptions by city | GSI1PK=`WS#{city}`, GSI1SK=connectionId | GSI1 |
| Deals by business | GSI2PK=`BIZ#{id}`, GSI2SK=`DEAL#{createdAt}` | GSI2 |
| User claim history | GSI3PK=`USER#{id}`, GSI3SK=`CLAIM#{claimedAt}` | GSI3 |
| Claim lookup by claimId | GSI4PK=`CLAIM#{claimId}` | GSI4 |
| User notifications | PK=`USER#{id}`, SK begins_with `NOTIF#` | Table |
| WebSocket connection | PK=`WS#{connectionId}`, SK=`CONNECTION` | Table |
| Business daily analytics | PK=`BIZ#{id}`, SK begins_with `ANALYTICS#` | Table |
| Deal analytics | PK=`DEAL#{id}`, SK begins_with `ANALYTICS#` | Table |

---

## 19. Redis Key Patterns

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `geo:deals:{city}` | Sorted Set (geo) | -- | Geospatial index of active deals per city |
| `deal:{dealId}` | String (JSON) | 3600s | Cached deal metadata |
| `flash:{city}:{dealId}` | String (JSON) | Until deal expiry | Flash deal data |
| `stats:deals:{city}` | Counter | -- | Total deals created in city |
| `stats:claims:{city}` | Counter | -- | Total claims in city |
| `stats:redemptions:{city}` | Counter | -- | Total redemptions in city |
| `stats:city:{city}` | String (JSON) | 300s | Cached city stats for public endpoint |
| `biz:{businessId}:redemptions` | Counter | -- | Per-business redemption count |
| `analytics:daily:{YYYY-MM-DD}` | Hash | -- | Platform-wide daily analytics |
| `analytics:biz:{businessId}:{YYYY-MM-DD}` | Hash | 30 days | Per-business daily analytics |
| `analytics:deal:{dealId}` | Hash | -- | Deal lifetime analytics |

---

## 20. Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)
- Node.js 20 or later
- npm

### Bootstrap (first time only)

```bash
cdk bootstrap aws://ACCOUNT_ID/eu-west-1
```

### Deploy a Single Stage

```bash
npx cdk deploy "NearDeal-{stage}/**" -c stage={stage} --require-approval never
```

Replace `{stage}` with `dev`, `staging`, or `prod`.

### Deploy All Stages in Parallel

Use separate output directories to avoid CloudFormation template conflicts:

```bash
npx cdk deploy "NearDeal-dev/**" -c stage=dev --output cdk.out.dev --require-approval never &
npx cdk deploy "NearDeal-staging/**" -c stage=staging --output cdk.out.staging --require-approval never &
npx cdk deploy "NearDeal-prod/**" -c stage=prod --output cdk.out.prod --require-approval never &
wait
```

### Pipeline Deployment

The CDK Pipeline is the recommended approach for staging and production:

1. Push to the `main` branch of `EthanDev/neardeal-infrastructure`
2. The pipeline automatically deploys to **staging**
3. After validation, approve the **PromoteToProd** manual approval gate
4. The pipeline deploys to **production**

### Post-Deploy Manual Steps

1. Replace the placeholder value in `neardeal/{stage}/stripe-webhook-secret` with the real Stripe signing secret
2. Replace `pk_test_PLACEHOLDER` in the business Amplify app with the real Stripe publishable key
3. Verify the AWS account to unblock CloudFront distribution creation

---

## 21. Cost Estimate

Estimated monthly costs at launch scale (500 businesses, 5,000 consumers):

| Service | Monthly Cost |
|---------|-------------|
| Cognito (10K users) | ~$0 (free tier) |
| DynamoDB (on-demand) | ~$25 |
| ElastiCache (cache.t3.medium) | ~$50 |
| Lambda (~2M invocations) | ~$15 |
| API Gateway | ~$10 |
| S3 + CloudFront | ~$10 |
| SQS + SNS | ~$5 |
| Location Service | ~$20 |
| SES | ~$2 |
| Amplify Hosting (2 apps) | ~$30 |
| Secrets Manager | ~$2 |
| CloudWatch + X-Ray | ~$15 |
| NAT Gateway | ~$35 |
| **Total** | **~$220/mo** |

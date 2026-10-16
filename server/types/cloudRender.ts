export type CloudJobStatus =
  | 'queued'
  | 'dispatching'
  | 'rendering'
  | 'done'
  | 'failed'
  | 'cancelled';

export type CloudRenderProvider =
  | 'aws-lambda'
  | 'gcp-cloudrun'
  | 'in-memory';

export interface AwsRenderConfig {
  composition: string;
  inputProps: any;

  fps: number;
  totalFrames: number;

  /**
   * Desired number of Lambda functions for this render.
   *
   * This is the only concurrency control sent to Remotion.
   */
  requestedLambdaConcurrency: number;

  /**
   * Actual concurrency reserved by the ContentGen governor.
   */
  lambdaConcurrency: number;

  /**
   * Informational value only.
   *
   * This is NOT passed to renderMediaOnLambda().
   */
  estimatedFramesPerLambda: number;

  privacy: 'public' | 'private' | 'no-acl';

  preparedAt: number;
}

export interface CloudJob {
  id: string;
  userId: string;
  title: string;

  status: CloudJobStatus;
  progress: number;
  provider: CloudRenderProvider;

  outputUrl?: string;
  outputUrlExpiresAt?: number;

  outputFilePath?: string;

  // AWS / Remotion
  renderId?: string;
  bucketName?: string;
  outputBucket?: string;
  outputKey?: string;
  functionName?: string;
  region?: string;

  // Persisted configuration required for restart recovery.
  renderConfig?: AwsRenderConfig;

  dispatchStartedAt?: number;

  error?: string;

  webhookSecret?: string;

  chargedMinutes?: number;
  chargedUserId?: string;
  refunded?: boolean;

  totalDurationSec?: number;

  createdAt: number;
  updatedAt: number;

  inMemoryOptions?: any;
}

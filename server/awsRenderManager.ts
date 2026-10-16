import {
  getRenderProgress,
  renderMediaOnLambda,
  type AwsRegion,
} from '@remotion/lambda';

import {
  getJob,
  setJob,
  listActiveJobs,
} from './jobStore';

import {
  getS3PresignedUrlForBucket,
} from './s3Storage';

import type { CloudJob, AwsRenderConfig } from './types/cloudRender';
import { chargeJobRenderUsage } from './usageAccounting';

interface QueuedAwsJob {
  jobId: string;
}

const queue: QueuedAwsJob[] = [];

/**
 * jobId -> number of Lambda renderer slots reserved for that render.
 *
 * The current Cloud Run deployment is intentionally configured with
 * max-instances=1, so this in-process governor is authoritative.
 *
 * If max-instances is ever increased above 1, replace this with a
 * Firestore distributed lease before increasing Cloud Run instances.
 */
const allocations = new Map<string, number>();

const queuedIds = new Set<string>();

let recoveryTimer: NodeJS.Timeout | undefined;
let started = false;

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

/**
 * Conservative total AWS concurrency budget.
 *
 * Default is 400 (or 540 via env), leaving substantial headroom in the AWS account.
 */
export function getAwsConcurrencyBudget(): number {
  return positiveInt(
    'REMOTION_AWS_CONCURRENCY_BUDGET',
    400
  );
}

/**
 * Maximum number of user render jobs simultaneously launched.
 */
export function getMaxConcurrentAwsJobs(): number {
  return positiveInt(
    'REMOTION_MAX_CONCURRENT_RENDERS',
    2
  );
}

/**
 * Maximum Lambda renderer functions allocated to one render.
 */
export function getMaxLambdaConcurrencyPerRender(): number {
  return positiveInt(
    'REMOTION_AWS_MAX_LAMBDA_CONCURRENCY',
    180
  );
}

export function getMinLambdaConcurrencyPerRender(): number {
  return positiveInt(
    'REMOTION_AWS_MIN_LAMBDA_CONCURRENCY',
    16
  );
}

/**
 * Target chunk duration in seconds.
 *
 * 20 seconds is a safe starting point for ContentGen because the
 * composition includes video, image effects, subtitles, graphics,
 * camera movement and optional WebGL/parallax.
 */
export function getTargetChunkSeconds(): number {
  const value = Number(
    process.env.REMOTION_TARGET_CHUNK_SECONDS
  );

  return Number.isFinite(value) && value >= 5
    ? value
    : 20;
}

/**
 * Remotion Lambda supports up to 200 renderer functions for one render.
 *
 * ContentGen intentionally keeps its own per-render cap lower than that
 * so that AWS account concurrency is not exhausted by a single render.
 */
export function calculateDesiredLambdaConcurrency(
  totalFrames: number,
  fps: number = 30
): number {
  const REMOTION_MAX_CONCURRENCY = 200;

  const targetFramesPerChunk = Math.max(
    30,
    Math.round(fps * getTargetChunkSeconds())
  );

  const estimatedChunks = Math.ceil(
    totalFrames / targetFramesPerChunk
  );

  const configuredMaximum =
    getMaxLambdaConcurrencyPerRender();

  const maximum = Math.min(
    REMOTION_MAX_CONCURRENCY,
    configuredMaximum
  );

  const minConcurrency = Math.min(totalFrames, getMinLambdaConcurrencyPerRender());

  return Math.max(
    1,
    minConcurrency,
    Math.min(
      maximum,
      estimatedChunks
    )
  );
}

/**
 * Backward-compatible helper for callers calculating estimated frames per lambda.
 */
export function calculateOptimalFramesPerLambda(
  totalFrames: number,
  fps: number = 30
): number {
  const desiredConcurrency = calculateDesiredLambdaConcurrency(totalFrames, fps);
  return Math.ceil(totalFrames / Math.max(1, desiredConcurrency));
}

export function getLambdaDelayRenderTimeout(): number {
  const value = Number(
    process.env.REMOTION_LAMBDA_DELAY_RENDER_TIMEOUT_MS
  );

  if (Number.isFinite(value) && value >= 1000) {
    return Math.floor(value);
  }

  return 120000;
}

export function getLambdaX264Preset():
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'
  | 'placebo' {
  const value = (
    process.env.REMOTION_X264_PRESET ||
    'fast'
  ).trim();

  const valid = [
    'superfast',
    'veryfast',
    'faster',
    'fast',
    'medium',
    'slow',
    'slower',
    'veryslow',
    'placebo',
  ] as const;

  if ((valid as readonly string[]).includes(value)) {
    return value as typeof valid[number];
  }

  return 'fast';
}

function getUsedConcurrency(): number {
  let total = 0;

  for (const slots of allocations.values()) {
    total += slots;
  }

  return total;
}

export function reserveConcurrency(
  jobId: string,
  requestedConcurrency: number
): number | null {
  const existing = allocations.get(jobId);

  if (existing !== undefined) {
    return existing;
  }

  if (allocations.size >= getMaxConcurrentAwsJobs()) {
    return null;
  }

  const budget = getAwsConcurrencyBudget();
  const used = getUsedConcurrency();
  const available = budget - used;

  if (available < 1) {
    return null;
  }

  const requested = Math.max(
    1,
    Math.floor(requestedConcurrency || 1)
  );

  const effective = Math.min(
    requested,
    getMaxLambdaConcurrencyPerRender(),
    200,
    available
  );

  if (effective < 1) {
    return null;
  }

  allocations.set(jobId, effective);

  return effective;
}

export function releaseConcurrency(jobId: string): void {
  allocations.delete(jobId);
}

export function releaseAwsConcurrency(jobId: string): void {
  releaseConcurrency(jobId);
}

export function dequeueAwsJob(jobId: string): boolean {
  const index = queue.findIndex((entry) => entry.jobId === jobId);
  if (index >= 0) {
    queue.splice(index, 1);
    queuedIds.delete(jobId);
    return true;
  }
  return false;
}

function enqueueUnique(jobId: string): void {
  if (queuedIds.has(jobId)) {
    return;
  }

  queuedIds.add(jobId);
  queue.push({ jobId });
}

export function getAwsQueuePosition(
  jobId: string
): number | undefined {
  const index = queue.findIndex(
    (entry) => entry.jobId === jobId
  );

  return index >= 0 ? index + 1 : undefined;
}

export function getActiveAwsJobCount(): number {
  return allocations.size;
}

export function getActiveAwsConcurrency(): number {
  return getUsedConcurrency();
}

async function failJob(
  job: CloudJob,
  message: string
): Promise<void> {
  releaseConcurrency(job.id);

  job.status = 'failed';
  job.progress = 0;
  job.error = message;
  job.updatedAt = Date.now();

  await setJob(job.id, job);
}

export function getOutputPrivacy(): 'public' | 'private' | 'no-acl' {
  const value = (
    process.env.REMOTION_AWS_OUTPUT_PRIVACY ||
    'private'
  ).trim().toLowerCase();

  if (value === 'no-acl') {
    return 'no-acl';
  }

  if (value === 'public') {
    return 'public';
  }

  return 'private';
}

export function getOutputUrlTtl(): number {
  return positiveInt(
    'REMOTION_AWS_OUTPUT_URL_TTL_SECONDS',
    900
  );
}

export function normalizeAwsError(
  raw: string
): string {
  const value = raw || 'Unknown AWS Lambda error';

  if (
    value.includes('TooManyRequestsException') ||
    value.includes('Rate Exceeded') ||
    value.toLowerCase().includes('concurrency')
  ) {
    return (
      'AWS Lambda concurrency was exceeded. ' +
      'The render governor has been tightened. ' +
      'Check the AWS Lambda Concurrent executions quota and ' +
      'REMOTION_AWS_CONCURRENCY_BUDGET.'
    );
  }

  if (
    value.includes('AccessDenied') ||
    value.includes('Access Denied')
  ) {
    return (
      'AWS/S3 access denied while starting the Remotion render. ' +
      'Verify the Remotion Lambda IAM policy, S3 bucket permissions ' +
      'and REMOTION_SERVE_URL.'
    );
  }

  if (
    value.includes('Version mismatch') ||
    value.includes('version mismatch')
  ) {
    return (
      'Remotion Lambda version mismatch. ' +
      'Deploy the Lambda function with the exact @remotion/lambda ' +
      'version used by this project.'
    );
  }

  if (
    value.includes('getStaticCompositions') ||
    value.includes('Could not find composition')
  ) {
    return (
      'The deployed Remotion site bundle does not contain the expected composition. ' +
      'Redeploy the Remotion site bundle.'
    );
  }

  return value;
}

export async function startAwsRender(jobId: string): Promise<void> {
  const job = await getJob(jobId);

  if (!job) {
    releaseConcurrency(jobId);
    return;
  }

  if (job.status === 'done' || job.status === 'failed') {
    releaseConcurrency(jobId);
    return;
  }

  const cfg = job.renderConfig;

  if (!cfg) {
    await failJob(
      job,
      'AWS render configuration is missing. The job cannot be recovered safely after a server restart.'
    );
    return;
  }

  const requestedConcurrency =
    cfg.requestedLambdaConcurrency ||
    Math.ceil(
      cfg.totalFrames /
      Math.max(1, cfg.estimatedFramesPerLambda || 600)
    );

  const concurrency = reserveConcurrency(
    job.id,
    requestedConcurrency
  );

  if (concurrency === null) {
    enqueueUnique(job.id);
    return;
  }

  const effectiveConcurrency = Math.min(concurrency, 200);

  cfg.lambdaConcurrency = effectiveConcurrency;

  job.renderConfig = cfg;
  job.status = 'dispatching';
  job.progress = Math.max(job.progress || 0, 1);
  job.dispatchStartedAt = Date.now();
  job.updatedAt = Date.now();

  await setJob(job.id, job);

  try {
    const estimatedFramesPerLambda = Math.ceil(
      cfg.totalFrames / Math.max(1, effectiveConcurrency)
    );

    console.log(
      `[AWS Manager] Dispatching ${job.id}: ` +
      `totalFrames=${cfg.totalFrames}, ` +
      `estimatedFramesPerLambda=${estimatedFramesPerLambda}, ` +
      `concurrency=${effectiveConcurrency}`
    );

    const serveUrl =
      process.env.REMOTION_SERVE_URL ||
      process.env.REMOTION_AWS_SERVE_URL ||
      '';

    const result = await renderMediaOnLambda({
      region: job.region as AwsRegion,
      functionName: job.functionName!,
      serveUrl,

      composition: cfg.composition,

      inputProps: cfg.inputProps,

      forceDurationInFrames: cfg.totalFrames,

      imageFormat: 'jpeg',
      jpegQuality: 90,

      codec: 'h264',
      crf: 18,

      /**
       * CRITICAL:
       *
       * Do not specify framesPerLambda when concurrency is set.
       * Remotion uses concurrency directly to distribute chunks.
       */
      concurrency: effectiveConcurrency,

      timeoutInMilliseconds: getLambdaDelayRenderTimeout(),

      x264Preset: getLambdaX264Preset(),

      privacy: cfg.privacy,

      maxRetries: 2,
    });

    const updated = (await getJob(job.id)) || job;

    updated.status = 'rendering';
    updated.progress = Math.max(
      updated.progress || 0,
      2
    );

    updated.renderId = result.renderId;
    updated.bucketName = result.bucketName;
    updated.outputBucket = result.bucketName;

    updated.updatedAt = Date.now();

    await setJob(job.id, updated);

  } catch (error: any) {
    const message =
      error?.message ||
      String(error);

    await failJob(
      job,
      normalizeAwsError(message)
    );

    await dispatchNextAwsJobs();
  }
}

export async function dispatchNextAwsJobs(): Promise<void> {
  while (queue.length > 0) {
    const next = queue[0];

    const job = await getJob(next.jobId);

    if (!job) {
      queue.shift();
      queuedIds.delete(next.jobId);
      continue;
    }

    if (job.status !== 'queued') {
      queue.shift();
      queuedIds.delete(next.jobId);
      continue;
    }

    if (!job.renderConfig) {
      queue.shift();
      queuedIds.delete(next.jobId);

      await failJob(
        job,
        'Queued AWS render is missing its persisted render configuration.'
      );

      continue;
    }

    const requestedConcurrency =
      job.renderConfig.requestedLambdaConcurrency ||
      Math.max(
        1,
        Math.ceil(
          job.renderConfig.totalFrames /
          Math.max(1, job.renderConfig.estimatedFramesPerLambda || 600)
        )
      );

    const available = reserveConcurrency(
      job.id,
      requestedConcurrency
    );

    if (available === null) {
      return;
    }

    queue.shift();
    queuedIds.delete(job.id);

    void startAwsRender(job.id);
  }
}

export function extractS3Key(
  url?: string
): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '');
  } catch {
    return undefined;
  }
}

export async function refreshAwsJob(
  job: CloudJob
): Promise<void> {
  if (
    job.provider !== 'aws-lambda' ||
    (job.status !== 'rendering' && job.status !== 'cancelled')
  ) {
    return;
  }

  if (
    !job.renderId ||
    !job.bucketName ||
    !job.functionName ||
    !job.region
  ) {
    return;
  }

  try {
    const progress = await getRenderProgress({
      renderId: job.renderId,
      bucketName: job.bucketName,
      functionName: job.functionName,
      region: job.region as AwsRegion,
    });

    if (progress.fatalErrorEncountered) {
      const firstError: any =
        progress.errors?.[0];

      const raw =
        firstError?.message ||
        (typeof firstError === 'string'
          ? firstError
          : '') ||
        'AWS Lambda render failed.';

      await failJob(
        job,
        normalizeAwsError(raw)
      );

      await dispatchNextAwsJobs();
      return;
    }

    if (progress.done) {
      job.status = 'done';
      job.progress = 100;

      job.outputUrl =
        progress.outputFile ||
        undefined;

      /**
       * Depending on the exact @remotion/lambda result type,
       * use the returned output key when available.
       */
      const progressAny: any = progress;

      job.outputKey =
        progressAny.outKey ||
        progressAny.outputKey ||
        extractS3Key(
          progress.outputFile || undefined
        ) ||
        undefined;

      job.outputBucket =
        progressAny.outBucket ||
        job.bucketName;

      if (
        job.outputBucket &&
        job.outputKey
      ) {
        const signed =
          await getS3PresignedUrlForBucket(
            job.outputBucket,
            job.region!,
            job.outputKey,
            getOutputUrlTtl()
          );

        if (signed) {
          job.outputUrl = signed;
          job.outputUrlExpiresAt =
            Date.now() +
            getOutputUrlTtl() * 1000;
        }
      }

      releaseConcurrency(job.id);
      await chargeJobRenderUsage(job);

    } else {
      job.progress = Math.max(
        2,
        Math.min(
          99,
          Math.round(
            (progress.overallProgress || 0) *
            100
          )
        )
      );
    }

    job.updatedAt = Date.now();

    await setJob(
      job.id,
      job
    );

  } catch (error: any) {
    console.warn(
      `[AWS Progress] ${job.id}:`,
      error?.message || error
    );

    /**
     * Do NOT immediately fail on one transient status polling error.
     * Lambda renders can outlive individual network requests.
     */
    job.updatedAt = Date.now();

    await setJob(
      job.id,
      job
    );
  }
}

export async function recoverAwsRenderState(): Promise<void> {
  try {
    const activeJobs = await listActiveJobs();

    /*
     * Rebuild Lambda allocations from persistent store.
     */
    allocations.clear();
    queue.length = 0;
    queuedIds.clear();

    // 1. Queued jobs: restore to queue exactly once
    const queuedJobs = activeJobs
      .filter(
        (job) =>
          job.provider === 'aws-lambda' &&
          job.status === 'queued' &&
          Boolean(job.renderConfig)
      )
      .sort(
        (a, b) =>
          (a.createdAt || 0) -
          (b.createdAt || 0)
      );

    for (const job of queuedJobs) {
      enqueueUnique(job.id);
    }

    /*
     * 2. "dispatching" recovery:
     * - If renderId exists, it successfully reached AWS: mark status as 'rendering' and allocate concurrency.
     * - If renderId is missing, requeue safely with idempotency.
     */
    const staleDispatches = activeJobs.filter(
      (job) =>
        job.provider === 'aws-lambda' &&
        job.status === 'dispatching'
    );

    for (const job of staleDispatches) {
      if (job.renderId) {
        job.status = 'rendering';
        job.progress = Math.max(job.progress || 1, 2);
        job.updatedAt = Date.now();
        await setJob(job.id, job);
        const concurrency = job.renderConfig?.lambdaConcurrency || 16;
        allocations.set(job.id, concurrency);
        continue;
      }

      job.status = 'queued';
      job.progress = 0;
      job.error = undefined;
      job.dispatchStartedAt = undefined;
      if (job.renderConfig) {
        job.renderConfig.lambdaConcurrency = 0;
      }
      job.updatedAt = Date.now();

      await setJob(job.id, job);
      enqueueUnique(job.id);
    }

    /*
     * 3. Restore allocations for surviving running/cancelled renders before status refresh.
     */
    const activeRunningOrCancelled = activeJobs.filter(
      (job) =>
        job.provider === 'aws-lambda' &&
        (job.status === 'rendering' || job.status === 'cancelled') &&
        Boolean(job.renderId)
    );

    for (const job of activeRunningOrCancelled) {
      const concurrency = job.renderConfig?.lambdaConcurrency || 16;
      allocations.set(job.id, concurrency);
    }

    /*
     * 4. Reconcile persisted jobs with actual AWS provider state before dispatching.
     */
    for (const job of activeRunningOrCancelled) {
      await refreshAwsJob(job);
    }

    /*
     * 5. Ensure completed or failed renders have allocations released exactly once.
     */
    const finishedJobs = activeJobs.filter(
      (job) =>
        job.provider === 'aws-lambda' &&
        (job.status === 'done' || job.status === 'failed')
    );
    for (const job of finishedJobs) {
      releaseConcurrency(job.id);
    }

    await dispatchNextAwsJobs();
  } catch (err) {
    console.warn('[AWS Recovery] Failed recovering render state:', err);
  }
}

export function startAwsRecoveryLoop(): void {
  if (started) {
    return;
  }

  started = true;

  void recoverAwsRenderState();

  recoveryTimer = setInterval(
    async () => {
      try {
        const active = await listActiveJobs();

        for (const job of active) {
          if (
            job.provider === 'aws-lambda' &&
            job.status === 'rendering'
          ) {
            await refreshAwsJob(job);
          }
        }

        await dispatchNextAwsJobs();

      } catch (error) {
        console.warn(
          '[AWS Recovery Loop]',
          error
        );
      }
    },
    15000
  );

  recoveryTimer.unref?.();
}

export interface EnqueueAwsRenderOptions {
  jobId: string;
  userId: string;
  title: string;

  inputProps: any;

  composition: string;

  fps: number;
  totalFrames: number;

  functionName: string;
  region: AwsRegion;

  serveUrl: string;
}

export async function enqueueAwsRender(
  options: EnqueueAwsRenderOptions
): Promise<{
  status: 'queued' | 'rendering';
  queuePosition?: number;
}> {
  const existing = await getJob(options.jobId);

  const requestedLambdaConcurrency = calculateDesiredLambdaConcurrency(
    options.totalFrames,
    options.fps
  );

  const estimatedFramesPerLambda = Math.ceil(
    options.totalFrames / Math.max(1, requestedLambdaConcurrency)
  );

  const privacy = getOutputPrivacy();

  const renderConfig: AwsRenderConfig = {
    composition: options.composition,
    inputProps: options.inputProps,
    fps: options.fps,
    totalFrames: options.totalFrames,
    requestedLambdaConcurrency,
    lambdaConcurrency: 0,
    estimatedFramesPerLambda,
    privacy,
    preparedAt: Date.now(),
  };

  const job: CloudJob = {
    ...(existing || {}),
    id: options.jobId,
    userId: options.userId,
    title: options.title,
    status: 'queued',
    progress: 0,
    provider: 'aws-lambda',
    functionName: options.functionName,
    region: options.region,
    renderConfig,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  await setJob(
    options.jobId,
    job
  );

  enqueueUnique(
    options.jobId
  );

  await dispatchNextAwsJobs();

  const updated = await getJob(options.jobId);

  return {
    status: updated?.status === 'rendering' ? 'rendering' : 'queued',
    queuePosition:
      updated?.status === 'rendering'
        ? undefined
        : getAwsQueuePosition(options.jobId),
  };
}

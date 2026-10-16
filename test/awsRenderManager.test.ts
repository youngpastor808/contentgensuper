import assert from 'node:assert/strict';
import {
  calculateOptimalFramesPerLambda,
  getAwsConcurrencyBudget,
  getMaxConcurrentAwsJobs,
  getMaxLambdaConcurrencyPerRender,
  getMinLambdaConcurrencyPerRender,
  reserveConcurrency,
  releaseConcurrency,
  getActiveAwsJobCount,
  getActiveAwsConcurrency,
  normalizeAwsError,
  getOutputPrivacy,
} from '../server/awsRenderManager';

console.log('--- Running AWS Render Manager & Concurrency Governor Test Suite ---');

// 1. calculateOptimalFramesPerLambda tests
{
  const fps = 30;

  // 10 minutes
  const totalFrames10 = 10 * 60 * fps;
  const fpl10 = calculateOptimalFramesPerLambda(totalFrames10, fps);
  const chunks10 = Math.ceil(totalFrames10 / fpl10);
  assert(chunks10 <= 190, `10min chunks (${chunks10}) exceeds 190`);
  assert(fpl10 >= 30, `10min framesPerLambda (${fpl10}) must be >= 30`);
  console.log(`✓ 10-minute 30fps: ${chunks10} chunks (${fpl10} frames/lambda)`);

  // 30 minutes
  const totalFrames30 = 30 * 60 * fps;
  const fpl30 = calculateOptimalFramesPerLambda(totalFrames30, fps);
  const chunks30 = Math.ceil(totalFrames30 / fpl30);
  assert(chunks30 <= 190, `30min chunks (${chunks30}) exceeds 190`);
  console.log(`✓ 30-minute 30fps: ${chunks30} chunks (${fpl30} frames/lambda)`);

  // 40 minutes
  const totalFrames40 = 40 * 60 * fps;
  const fpl40 = calculateOptimalFramesPerLambda(totalFrames40, fps);
  const chunks40 = Math.ceil(totalFrames40 / fpl40);
  assert(chunks40 <= 190, `40min chunks (${chunks40}) exceeds 190`);
  console.log(`✓ 40-minute 30fps: ${chunks40} chunks (${fpl40} frames/lambda)`);

  // 60 minutes
  const totalFrames60 = 60 * 60 * fps;
  const fpl60 = calculateOptimalFramesPerLambda(totalFrames60, fps);
  const chunks60 = Math.ceil(totalFrames60 / fpl60);
  assert(chunks60 <= 190, `60min chunks (${chunks60}) exceeds 190`);
  console.log(`✓ 60-minute 30fps: ${chunks60} chunks (${fpl60} frames/lambda)`);

  // 75 minutes
  const totalFrames75 = 75 * 60 * fps;
  const fpl75 = calculateOptimalFramesPerLambda(totalFrames75, fps);
  const chunks75 = Math.ceil(totalFrames75 / fpl75);
  assert(chunks75 <= 190, `75min chunks (${chunks75}) exceeds 190`);
  console.log(`✓ 75-minute 30fps: ${chunks75} chunks (${fpl75} frames/lambda)`);
}

// 2. Concurrency Governor Allocations tests
{
  process.env.REMOTION_MAX_CONCURRENT_RENDERS = '3';
  process.env.REMOTION_AWS_CONCURRENCY_BUDGET = '540';
  process.env.REMOTION_AWS_MAX_LAMBDA_CONCURRENCY = '180';
  process.env.REMOTION_AWS_MIN_LAMBDA_CONCURRENCY = '16';

  releaseConcurrency('job-1');
  releaseConcurrency('job-2');
  releaseConcurrency('job-3');
  releaseConcurrency('job-4');

  const budget = getAwsConcurrencyBudget();
  const maxPerRender = getMaxLambdaConcurrencyPerRender();
  const maxJobs = getMaxConcurrentAwsJobs();

  assert(budget >= 500, `Expected budget >= 500, got ${budget}`);
  assert.equal(maxPerRender, 180);
  assert.equal(maxJobs, 3);

  const alloc1 = reserveConcurrency('job-1', 190);
  assert.equal(alloc1, 180, `Job 1 expected 180, got ${alloc1}`);

  const alloc2 = reserveConcurrency('job-2', 190);
  assert.equal(alloc2, 180, `Job 2 expected 180, got ${alloc2}`);

  const alloc3 = reserveConcurrency('job-3', 190);
  assert.equal(alloc3, 180, `Job 3 expected 180, got ${alloc3}`);

  assert.equal(getActiveAwsJobCount(), 3);
  assert.equal(getActiveAwsConcurrency(), 540);

  // 4th job must be queued (returns null)
  const alloc4 = reserveConcurrency('job-4', 190);
  assert.equal(alloc4, null, 'Job 4 should be queued when pool is full');

  // Release job-1 and verify job-4 can now obtain an allocation
  releaseConcurrency('job-1');
  assert.equal(getActiveAwsJobCount(), 2);
  assert.equal(getActiveAwsConcurrency(), 360);

  const alloc4AfterRelease = reserveConcurrency('job-4', 100);
  assert.equal(alloc4AfterRelease, 100);
  assert.equal(getActiveAwsJobCount(), 3);
  assert.equal(getActiveAwsConcurrency(), 460);

  releaseConcurrency('job-2');
  releaseConcurrency('job-3');
  releaseConcurrency('job-4');
  console.log('✓ Concurrency governor allocations & queue ceiling verified.');
}

// 3. Error normalization and privacy
{
  const msg1 = normalizeAwsError('TooManyRequestsException: Rate Exceeded');
  assert(msg1.includes('concurrency was exceeded'), `Unexpected normalized msg: ${msg1}`);

  const msg2 = normalizeAwsError('AccessDenied on s3:GetObject');
  assert(msg2.includes('access denied'), `Unexpected normalized msg: ${msg2}`);

  const privacy = getOutputPrivacy();
  assert(['private', 'no-acl', 'public'].includes(privacy), `Unexpected privacy: ${privacy}`);
  console.log('✓ AWS error normalization and output privacy verified.');
}

console.log('========================================');
console.log('ALL AWS RENDER MANAGER TESTS PASSED!');
console.log('========================================');

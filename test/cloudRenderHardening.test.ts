import assert from 'node:assert/strict';
import {
  safeCompareSecret,
  authorizeJobAccess,
  isValidTrustedStorageOutputUrl,
  validateSafeRemoteUrl,
  isJobSpecificOutputKey,
  isValidRenderBucket,
  isValidRenderId
} from '../server/routes/cloudRender';
import {
  reserveConcurrency,
  releaseConcurrency,
  dequeueAwsJob,
  getActiveAwsJobCount,
  getActiveAwsConcurrency
} from '../server/awsRenderManager';
import { listJobsForUser } from '../server/jobStore';
import { calculateChargeableMinutes, chargeJobRenderUsage } from '../server/usageAccounting';
import type { CloudJob } from '../server/types/cloudRender';

console.log('--- Running Cloud Render Hardening & Security Test Suite ---');

// 1. Webhook Constant-Time Secret Comparison
{
  const secretA = 'abf6289bc40192e47209da3842109e4f';
  const secretB = 'abf6289bc40192e47209da3842109e4f';
  const secretC = 'wrong_secret_1234567890abcdef123';
  const secretShort = 'short';

  assert.equal(safeCompareSecret(secretA, secretB), true, 'Identical secrets must match');
  assert.equal(safeCompareSecret(secretA, secretC), false, 'Different secrets must fail');
  assert.equal(safeCompareSecret(secretA, secretShort), false, 'Different length secrets must fail');
  assert.equal(safeCompareSecret(undefined, secretA), false, 'Missing provided secret must fail');
  assert.equal(safeCompareSecret(secretA, undefined), false, 'Missing expected secret must fail');
  assert.equal(safeCompareSecret(null as any, secretA), false, 'Null provided secret must fail');

  console.log('✓ Webhook safeCompareSecret verification passed.');
}

// 2. AWS Concurrency Idempotency & Dequeueing
{
  const testJobId = 'test-job-hardening-1';
  releaseConcurrency(testJobId);

  const initialCount = getActiveAwsJobCount();

  // First reservation
  const alloc1 = reserveConcurrency(testJobId, 32);
  assert(alloc1 !== null && alloc1 > 0, 'Reservation 1 must succeed');

  // Second reservation (idempotency test - should return same allocation without increasing count)
  const alloc2 = reserveConcurrency(testJobId, 32);
  assert.equal(alloc1, alloc2, 'Subsequent reservation for same jobId must be idempotent');
  assert.equal(getActiveAwsJobCount(), initialCount + 1, 'Job count must not double on idempotent reserve');

  // Release (first release)
  releaseConcurrency(testJobId);
  assert.equal(getActiveAwsJobCount(), initialCount, 'Job count must return to initial after release');

  // Second release (idempotency test - releasing non-existent/already released jobId must not throw)
  assert.doesNotThrow(() => {
    releaseConcurrency(testJobId);
  }, 'Duplicate release must be safe and idempotent');

  // Dequeue non-existent job must safely return false
  const dequeued = dequeueAwsJob('non-existent-job-id');
  assert.equal(dequeued, false, 'Dequeue non-existent must return false');

  console.log('✓ Concurrency reservation/release idempotency and dequeue verified.');
}

// 3. Cross-User Job Authorization & Wildcard Rejection
async function testCrossUserIsolation() {
  // listJobsForUser must fail closed on missing/empty userId
  const emptyRes1 = await listJobsForUser(undefined as any);
  assert.deepEqual(emptyRes1, [], 'listJobsForUser(undefined) must return empty array and never act as wildcard');

  const emptyRes2 = await listJobsForUser('');
  assert.deepEqual(emptyRes2, [], 'listJobsForUser("") must return empty array');

  const emptyRes3 = await listJobsForUser('   ');
  assert.deepEqual(emptyRes3, [], 'listJobsForUser("   ") must return empty array');

  const mockJobUserA: CloudJob = {
    id: 'job_user_a_101',
    userId: 'user_a_123',
    title: 'User A Video',
    status: 'done',
    progress: 100,
    provider: 'aws-lambda',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Mock requests for authorizeJobAccess
  const reqUserA: any = { headers: { authorization: 'Bearer token_user_a' } };
  const reqUserB: any = { headers: { authorization: 'Bearer token_user_b' } };
  const reqUnauth: any = { headers: {} };

  // Owner access
  const authOwner = await authorizeJobAccess({
    ...reqUserA,
    user: { uid: 'user_a_123' }
  } as any, mockJobUserA);
  assert.equal(authOwner, true, 'Job owner must be authorized');

  // Cross-user unauthorized access attempt
  const authCross = await authorizeJobAccess({
    ...reqUserB,
    user: { uid: 'user_b_456' }
  } as any, mockJobUserA);
  assert.equal(authCross, false, 'Non-owner ordinary user must be rejected');

  // Unauthenticated access attempt
  const authUnauth = await authorizeJobAccess(reqUnauth, mockJobUserA);
  assert.equal(authUnauth, false, 'Unauthenticated caller must be rejected');

  console.log('✓ Cross-user job isolation and fail-closed wildcard checks verified.');
}

// 4. Webhook Output Metadata & Storage Allowlist Validation
{
  // Output Key validation against job ID and path traversal
  assert.equal(isJobSpecificOutputKey('renders/job-101.mp4', 'job-101'), true, 'Valid job outputKey must pass');
  assert.equal(isJobSpecificOutputKey('renders/render_xyz_job-101/out.mp4', 'job-101'), true, 'Valid job render outputKey must pass');
  assert.equal(isJobSpecificOutputKey('../etc/passwd', 'job-101'), false, 'Path traversal outputKey must fail');
  assert.equal(isJobSpecificOutputKey('/renders/job-101.mp4', 'job-101'), false, 'Root-relative outputKey must fail');
  assert.equal(isJobSpecificOutputKey('renders/other-job-999.mp4', 'job-101'), false, 'OutputKey for another job must fail');

  // Render Bucket validation
  assert.equal(isValidRenderBucket('evil-bucket', 'aws-lambda'), false, 'Untrusted bucket must fail');
  assert.equal(isValidRenderBucket('evil-bucket', 'gcp-cloudrun'), false, 'Untrusted GCP bucket must fail');

  // Render ID format validation
  assert.equal(isValidRenderId('render_123_abc_456'), true, 'Valid renderId format must pass');
  assert.equal(isValidRenderId('../../evil'), false, 'Path traversal renderId must fail');
  assert.equal(isValidRenderId('render<script>'), false, 'Malicious tag renderId must fail');

  // Storage URL Fail-Closed Validation
  assert.equal(isValidTrustedStorageOutputUrl('https://evil-attacker.com/video.mp4', 'aws-lambda'), false, 'Attacker URL must fail');
  assert.equal(isValidTrustedStorageOutputUrl('http://s3.amazonaws.com/my-bucket/out.mp4', 'aws-lambda'), false, 'HTTP URL must fail');
  assert.equal(isValidTrustedStorageOutputUrl('https://s3.amazonaws.com:8443/my-bucket/out.mp4', 'aws-lambda'), false, 'Non-443 port must fail');

  console.log('✓ Output metadata and storage allowlist validation verified.');
}

// 5. SSRF Destination, Metadata & Protocol Protection
async function testSsrfProtections() {
  // Non-HTTPS
  await assert.rejects(
    async () => validateSafeRemoteUrl('http://s3.amazonaws.com/out.mp4'),
    /Only HTTPS remote URLs are permitted/,
    'HTTP URLs must be rejected'
  );

  // Non-standard port
  await assert.rejects(
    async () => validateSafeRemoteUrl('https://s3.amazonaws.com:8443/out.mp4'),
    /Non-standard ports are prohibited/,
    'Non-443 ports must be rejected'
  );

  // Private Loopback IP
  await assert.rejects(
    async () => validateSafeRemoteUrl('https://127.0.0.1/latest/meta-data'),
    /Forbidden destination IP address|Loopback/,
    '127.0.0.1 must be rejected'
  );

  // AWS Cloud Metadata IP
  await assert.rejects(
    async () => validateSafeRemoteUrl('https://169.254.169.254/latest/meta-data'),
    /strictly prohibited|Forbidden destination IP/,
    '169.254.169.254 metadata endpoint must be rejected'
  );

  // GCP Cloud Metadata Hostname
  await assert.rejects(
    async () => validateSafeRemoteUrl('https://metadata.google.internal/computeMetadata/v1/'),
    /Loopback and internal hostnames are prohibited|strictly prohibited/,
    'GCP metadata hostname must be rejected'
  );

  // Loopback Domain
  await assert.rejects(
    async () => validateSafeRemoteUrl('https://localhost/out.mp4'),
    /Loopback and internal hostnames are prohibited/,
    'localhost domain must be rejected'
  );

  console.log('✓ SSRF destination, metadata, and protocol protections verified.');
}

// 6. Server-Authoritative Usage Accounting
{
  const job10s: CloudJob = {
    id: 'job_10s',
    userId: 'user_a',
    title: '10s Video',
    status: 'done',
    progress: 100,
    provider: 'aws-lambda',
    totalDurationSec: 10,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const job65s: CloudJob = {
    id: 'job_65s',
    userId: 'user_a',
    title: '65s Video',
    status: 'done',
    progress: 100,
    provider: 'aws-lambda',
    totalDurationSec: 65,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  assert.equal(calculateChargeableMinutes(job10s), 1, '10s video must charge 1 minute');
  assert.equal(calculateChargeableMinutes(job65s), 2, '65s video must charge 2 minutes');

  // Failed and cancelled jobs must incur 0 charged minutes
  const failedJob: CloudJob = { ...job10s, status: 'failed' };
  const cancelledJob: CloudJob = { ...job10s, status: 'cancelled' };

  chargeJobRenderUsage(failedJob).then((m) => {
    assert.equal(m, 0, 'Failed job must consume 0 minutes');
  });

  chargeJobRenderUsage(cancelledJob).then((m) => {
    assert.equal(m, 0, 'Cancelled job must consume 0 minutes');
  });

  // Replay protection (idempotency)
  const replayedJob: CloudJob = { ...job10s, chargedMinutes: 2 };
  chargeJobRenderUsage(replayedJob).then((m) => {
    assert.equal(m, 2, 'Replayed job must return existing chargedMinutes without double charging');
  });

  console.log('✓ Server-authoritative usage accounting & replay protection verified.');
}

async function runAllTests() {
  await testCrossUserIsolation();
  await testSsrfProtections();

  console.log('====================================================');
  console.log('ALL CLOUD RENDER HARDENING TESTS PASSED SUCCESSFULLY');
  console.log('====================================================');
}

runAllTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});

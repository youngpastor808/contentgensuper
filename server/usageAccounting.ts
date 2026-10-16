import { getFirestoreDb } from './firebaseAdmin';
import type { CloudJob } from './types/cloudRender';

/**
 * Server-authoritative render usage calculation and Firestore transaction billing.
 */
export function calculateChargeableMinutes(job: CloudJob): number {
  const durationSec =
    Number(job.totalDurationSec) ||
    (job.inMemoryOptions?.durationInFrames
      ? job.inMemoryOptions.durationInFrames / (job.inMemoryOptions.fps || 30)
      : 0) ||
    (job.renderConfig?.totalFrames
      ? job.renderConfig.totalFrames / (job.renderConfig.fps || 30)
      : 0) ||
    10;

  return Math.max(1, Math.ceil(durationSec / 60));
}

/**
 * Atomically charges the user for a completed render in Firestore.
 * Idempotent: ensures each render is charged at most once.
 * Failed, cancelled, retried, and partially completed renders are NOT charged.
 */
export async function chargeJobRenderUsage(job: CloudJob): Promise<number> {
  // Idempotency check: validate each render is charged at most once
  if (typeof job.chargedMinutes === 'number' && job.chargedMinutes > 0) {
    return job.chargedMinutes;
  }

  // Failed, cancelled, running, or queued renders consume 0 quota
  if (job.status !== 'done') {
    return 0;
  }

  if (!job.userId || job.userId === 'anonymous') {
    job.chargedMinutes = 0;
    job.chargedUserId = 'anonymous';
    return 0;
  }

  const chargeableMinutes = calculateChargeableMinutes(job);

  try {
    const db = getFirestoreDb();
    if (db) {
      const userRef = db.collection('users').doc(job.userId);
      await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) {
          return;
        }
        const data = userDoc.data() || {};
        const currentUsed = typeof data.renderMinutesUsed === 'number' ? data.renderMinutesUsed : 0;
        transaction.update(userRef, {
          renderMinutesUsed: currentUsed + chargeableMinutes,
          updatedAt: new Date(),
        });
      });
    }
    job.chargedMinutes = chargeableMinutes;
    job.chargedUserId = job.userId;
    console.log(`[Usage Accounting] Authoritatively charged ${chargeableMinutes} min for job ${job.id} to user ${job.userId}`);
    return chargeableMinutes;
  } catch (err: any) {
    // Do NOT set job.chargedMinutes on failure so reconciliation retries can re-attempt billing
    console.warn(`[Usage Accounting Note] Firestore transaction error for job ${job.id}:`, err?.message || err);
    return 0;
  }
}

/**
 * Preflight check to verify user has sufficient render quota before starting render.
 */
export async function checkUserQuota(
  userId: string,
  requestedSeconds: number
): Promise<{ ok: boolean; remaining: number; quota: number; required: number }> {
  const DEFAULT_QUOTA = 10;
  const required = Math.max(1, Math.ceil(requestedSeconds / 60));

  if (!userId || userId === 'anonymous') {
    return { ok: required <= DEFAULT_QUOTA, remaining: DEFAULT_QUOTA, quota: DEFAULT_QUOTA, required };
  }

  try {
    const db = getFirestoreDb();
    if (!db) {
      return { ok: required <= DEFAULT_QUOTA, remaining: DEFAULT_QUOTA, quota: DEFAULT_QUOTA, required };
    }
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { ok: required <= DEFAULT_QUOTA, remaining: DEFAULT_QUOTA, quota: DEFAULT_QUOTA, required };
    }
    const data = userDoc.data() || {};
    const quota = typeof data.renderMinutesQuota === 'number' ? data.renderMinutesQuota : DEFAULT_QUOTA;
    const used = typeof data.renderMinutesUsed === 'number' ? data.renderMinutesUsed : 0;
    const remaining = Math.max(0, quota - used);
    return {
      ok: used + required <= quota,
      remaining,
      quota,
      required,
    };
  } catch {
    return { ok: required <= DEFAULT_QUOTA, remaining: DEFAULT_QUOTA, quota: DEFAULT_QUOTA, required };
  }
}

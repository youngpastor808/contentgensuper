import { getFirestoreDb } from './firebaseAdmin';
import type { CloudJob } from './types/cloudRender';
import { LRUCache } from '../src/lru-cache';

const COLLECTION = 'cloudRenderJobs';
// Cap in-memory job cache to 500 recent jobs to prevent unbounded memory growth
const localCache = new LRUCache<string, CloudJob>(500);
let hasLoggedFirestoreError = false;

function cleanForFirestore<T extends Record<string, any>>(obj: T): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

export async function setJob(jobId: string, job: CloudJob): Promise<void> {
  localCache.set(jobId, job);
  try {
    const db = getFirestoreDb();
    if (!db) return;
    const data = cleanForFirestore(job);
    await db.collection(COLLECTION).doc(jobId).set(data, { merge: true });
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore note: persisting to local cache (remote Firestore sync: ${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
  }
}

export async function getJob(jobId: string): Promise<CloudJob | undefined> {
  if (localCache.has(jobId)) return localCache.get(jobId);
  try {
    const db = getFirestoreDb();
    if (!db) return undefined;
    const doc = await db.collection(COLLECTION).doc(jobId).get();
    if (!doc.exists) return undefined;
    const job = doc.data() as CloudJob;
    localCache.set(jobId, job);
    return job;
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore read note: falling back to local cache (${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
    return undefined;
  }
}

export async function deleteJob(jobId: string): Promise<void> {
  localCache.delete(jobId);
  try {
    const db = getFirestoreDb();
    if (!db) return;
    await db.collection(COLLECTION).doc(jobId).delete();
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore delete note: (${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
  }
}

export async function listJobsForUser(userId: string, limit = 30): Promise<CloudJob[]> {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    // Fail-closed: missing or empty userId MUST NEVER act as a wildcard
    return [];
  }
  const cleanUid = userId.trim();
  try {
    const db = getFirestoreDb();
    if (db) {
      const q = db.collection(COLLECTION)
        .where('userId', '==', cleanUid)
        .orderBy('createdAt', 'desc')
        .limit(limit);
      const snap = await q.get();
      const jobs = snap.docs.map((d) => d.data() as CloudJob);
      jobs.forEach((j: CloudJob) => localCache.set(j.id, j));
      return jobs;
    }
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore list note: falling back to local cache (${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
  }

  return Array.from(localCache.values())
    .filter((j) => j.userId === cleanUid)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

export async function listAllJobsForAdmin(limit = 30): Promise<CloudJob[]> {
  try {
    const db = getFirestoreDb();
    if (db) {
      const q = db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(limit);
      const snap = await q.get();
      const jobs = snap.docs.map((d) => d.data() as CloudJob);
      jobs.forEach((j: CloudJob) => localCache.set(j.id, j));
      return jobs;
    }
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore admin list note: falling back to local cache (${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
  }

  return Array.from(localCache.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

export async function listActiveJobs(): Promise<CloudJob[]> {
  try {
    const db = getFirestoreDb();
    if (db) {
      const snap = await db
        .collection(COLLECTION)
        .where('status', 'in', ['rendering', 'queued', 'dispatching'])
        .get();
      const jobs = snap.docs.map((d) => d.data() as CloudJob);
      jobs.forEach((j) => localCache.set(j.id, j));
      return jobs;
    }
  } catch (err: any) {
    if (!hasLoggedFirestoreError) {
      console.warn(`[jobStore] Firestore active jobs note: falling back to local cache (${err?.message || err})`);
      hasLoggedFirestoreError = true;
    }
  }

  return Array.from(localCache.values()).filter(
    (j) => j.status === 'rendering' || j.status === 'queued' || j.status === 'dispatching'
  );
}

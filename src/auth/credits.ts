import { doc, collection, runTransaction, increment, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import { safeJsonStringify } from '../utils-core';
import { currentUser } from './session';

export const PENDING_SPENDS_KEY = 'pendingCreditSpends';

export function queueOfflineSpend(amount: number, reason: string) {
    try {
        const q = JSON.parse(localStorage.getItem(PENDING_SPENDS_KEY) || '[]');
        q.push({ amount, reason, at: Date.now() });
        localStorage.setItem(PENDING_SPENDS_KEY, JSON.stringify(q));
    } catch (e) {
        console.warn('Failed to queue offline spend:', e);
    }
}

export async function flushPendingSpends(): Promise<void> {
    try {
        const q = JSON.parse(localStorage.getItem(PENDING_SPENDS_KEY) || '[]');
        if (!q.length || !auth.currentUser) return;
        const total = q.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0);
        if (total <= 0) {
            localStorage.removeItem(PENDING_SPENDS_KEY);
            return;
        }
        await spendCreditsSecure(total, 'offline_catchup');
        localStorage.removeItem(PENDING_SPENDS_KEY);
        ui.showStatus(`Synced ${q.length} offline credit spend(s).`, false, 2500);
    } catch (e: any) {
        console.warn('Offline spend flush failed (balance may be short):', e?.message);
        ui.showStatus('Offline spends couldn\'t sync — check your credit balance.', true, 4000);
    }
}

export async function getFirebaseIdToken(): Promise<string> {
    try {
        if (auth.currentUser) {
            return await auth.currentUser.getIdToken();
        }
    } catch (e) {
        console.warn("Could not retrieve Firebase ID token:", e);
    }
    return '';
}

export async function spendCreditsSecure(amount: number, reason: string = 'generation'): Promise<number> {
    const safeAmount = Number(amount);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return state.userCredits ?? 0;
    }

    const currentBalance = state.userCredits ?? 0;

    // 1. If user is signed in with Firebase, perform atomic Firestore transaction & ledger entry
    if (auth.currentUser && auth.currentUser.uid) {
        const uid = auth.currentUser.uid;
        const userRef = doc(db, 'users', uid);
        const ledgerCol = collection(db, 'creditLedger');
        const dayKey = new Date().toISOString().slice(0, 10);
        const usageRef = doc(db, `usage/${uid}/daily/${dayKey}`);

        try {
            const nextBalance = await runTransaction(db, async (transaction) => {
                const userSnap = await transaction.get(userRef);
                const userData = userSnap.data();
                const userStatus = userData?.status || 'pending';
                if (!userSnap.exists() || (userStatus !== 'approved' && userStatus !== 'active')) {
                    throw new Error('Account is not approved.');
                }
                const currentCredits = (userSnap.exists() && typeof userData?.credits === 'number')
                    ? userData.credits
                    : (state.userCredits ?? 0);

                if (currentCredits < safeAmount) {
                    throw new Error(`Insufficient credits: requires ${safeAmount}, available ${currentCredits}`);
                }

                const after = currentCredits - safeAmount;
                transaction.update(userRef, {
                    credits: after,
                    updatedAt: new Date().toISOString()
                });

                const ledgerRef = doc(ledgerCol);
                transaction.set(ledgerRef, {
                    uid,
                    amount: -safeAmount,
                    reason: String(reason).slice(0, 200),
                    at: new Date().toISOString(),
                    balanceAfter: after
                });

                transaction.set(usageRef, {
                    spend: increment(safeAmount),
                    count: increment(1)
                }, { merge: true });

                return after;
            });

            state.userCredits = nextBalance;
            localStorage.setItem('userCredits', String(nextBalance));
            if (dom.userCreditsDisplay) ui.updateCreditsDisplay();

            return nextBalance;
        } catch (err: any) {
            console.error("Firestore credit transaction failed:", err?.message || err);
            // Re-throw so generation stops safely instead of allowing unmetered usage
            throw err;
        }
    }

    // 2. Offline / Local session verification
    if (currentBalance < safeAmount) {
        throw new Error(`Insufficient credits: requires ${safeAmount}, available ${currentBalance}`);
    }

    queueOfflineSpend(safeAmount, reason);
    const nextLocal = currentBalance - safeAmount;
    syncUserCredits(nextLocal);
    return nextLocal;
}

export function syncUserCredits(newCredits: number) {
    state.userCredits = newCredits;
    localStorage.setItem('userCredits', String(newCredits));
    if (dom.userCreditsDisplay) ui.updateCreditsDisplay();

    const savedSession = localStorage.getItem('local_auth_session');
    if (savedSession) {
        try {
            const parsed = JSON.parse(savedSession);
            if (parsed?.record) {
                parsed.record.credits = newCredits;
                localStorage.setItem('local_auth_session', safeJsonStringify(parsed));
            }
        } catch (e) {
            console.warn("Could not parse local auth session for credits update:", e);
        }
    }
}

export async function recordRenderMinutesUsageSecure(minutesToDeduct: number, reason: string = 'Cloud video render'): Promise<{ used: number; remaining: number }> {
    const safeMins = Math.max(1, Math.ceil(minutesToDeduct));
    const uid = currentUser?.uid;

    if (uid && db) {
        try {
            const userRef = doc(db, 'users', uid);
            await runTransaction(db, async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists()) {
                    throw new Error('User record not found in database.');
                }
                const data = userDoc.data() || {};
                const currentUsed = typeof data.renderMinutesUsed === 'number' ? data.renderMinutesUsed : 0;
                const quota = typeof data.renderMinutesQuota === 'number' ? data.renderMinutesQuota : 10;

                if (currentUsed + safeMins > quota) {
                    throw new Error(`Insufficient Cloud Render quota: requires ${safeMins}m, but you have ${Math.max(0, quota - currentUsed)}m remaining (${quota}m total quota).`);
                }

                transaction.update(userRef, {
                    renderMinutesUsed: increment(safeMins),
                    updatedAt: serverTimestamp()
                });
            });

            state.renderMinutesUsed = (state.renderMinutesUsed || 0) + safeMins;
            return {
                used: state.renderMinutesUsed,
                remaining: Math.max(0, (state.renderMinutesQuota || 10) - state.renderMinutesUsed)
            };
        } catch (err: any) {
            // If explicit quota rejection was thrown, propagate it
            if (err?.message?.includes('Insufficient Cloud Render quota')) {
                throw err;
            }

            console.warn('Firestore transaction warning during render minute deduction. Proceeding with local state fallback:', err?.message || err);
            const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
            const used = state.renderMinutesUsed || 0;
            if (used + safeMins > quota) {
                throw new Error(`Insufficient Cloud Render quota: requires ${safeMins}m, but only ${Math.max(0, quota - used)}m remaining.`);
            }
            state.renderMinutesUsed = used + safeMins;
            return {
                used: state.renderMinutesUsed,
                remaining: Math.max(0, quota - state.renderMinutesUsed)
            };
        }
    }

    // Local / Offline session
    const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
    const used = state.renderMinutesUsed || 0;
    if (used + safeMins > quota) {
        throw new Error(`Insufficient Cloud Render quota: requires ${safeMins}m, but only ${Math.max(0, quota - used)}m remaining.`);
    }

    state.renderMinutesUsed = used + safeMins;
    return {
        used: state.renderMinutesUsed,
        remaining: Math.max(0, quota - state.renderMinutesUsed)
    };
}

export async function refundRenderMinutesSecure(minutesToRefund: number, reason: string = 'Cloud video render failed'): Promise<{ used: number; remaining: number }> {
    const safeMins = Math.max(1, Math.ceil(minutesToRefund));
    const uid = currentUser?.uid;

    if (uid && db) {
        try {
            const userRef = doc(db, 'users', uid);
            let refundedAmount = safeMins;
            try {
                await runTransaction(db, async (transaction) => {
                    const userDoc = await transaction.get(userRef);
                    if (!userDoc.exists()) {
                        return;
                    }
                    const data = userDoc.data() || {};
                    const currentUsed = typeof data.renderMinutesUsed === 'number' ? data.renderMinutesUsed : 0;
                    refundedAmount = Math.min(currentUsed, safeMins);
                    if (refundedAmount > 0) {
                        transaction.update(userRef, {
                            renderMinutesUsed: increment(-refundedAmount),
                            updatedAt: serverTimestamp()
                        });
                    }
                });
            } catch (txErr: any) {
                // If transaction fails (e.g. offline/unavailable in iframe), fallback to resilient updateDoc
                try {
                    const { updateDoc } = await import('firebase/firestore');
                    await updateDoc(userRef, {
                        renderMinutesUsed: increment(-safeMins),
                        updatedAt: serverTimestamp()
                    });
                    refundedAmount = safeMins;
                } catch (updateErr: any) {
                    console.warn('[Quota Refund] Firestore sync deferred (offline/unavailable), applying local refund:', updateErr?.message || updateErr);
                }
            }

            state.renderMinutesUsed = Math.max(0, (state.renderMinutesUsed || 0) - refundedAmount);
            const remaining = Math.max(0, (state.renderMinutesQuota || 10) - state.renderMinutesUsed);
            console.log(`[Quota Refund] Successfully refunded ${refundedAmount} minute(s). Reason: ${reason}. Remaining quota: ${remaining}m`);
            return {
                used: state.renderMinutesUsed,
                remaining
            };
        } catch (err: any) {
            console.warn('[Quota Refund] Firestore refund note, applied local state fallback:', err?.message || err);
            // Fallback: update local state so UI reflects refund
            state.renderMinutesUsed = Math.max(0, (state.renderMinutesUsed || 0) - safeMins);
            return {
                used: state.renderMinutesUsed,
                remaining: Math.max(0, (state.renderMinutesQuota || 10) - state.renderMinutesUsed)
            };
        }
    }

    // Local / Offline session
    const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
    state.renderMinutesUsed = Math.max(0, (state.renderMinutesUsed || 0) - safeMins);
    return {
        used: state.renderMinutesUsed,
        remaining: Math.max(0, quota - state.renderMinutesUsed)
    };
}

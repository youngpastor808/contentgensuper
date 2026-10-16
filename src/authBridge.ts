export type SyncUserCreditsFn = (...args: any[]) => any;
let syncImpl: SyncUserCreditsFn = async () => {};
export function registerSyncUserCredits(fn: SyncUserCreditsFn) { syncImpl = fn; }
export function syncUserCredits(...args: any[]) { return syncImpl(...args); }

export type SpendCreditsSecureFn = (...args: any[]) => any;
let spendImpl: SpendCreditsSecureFn = async () => {};
export function registerSpendCreditsSecure(fn: SpendCreditsSecureFn) { spendImpl = fn; }
export function spendCreditsSecure(...args: any[]) { return spendImpl(...args); }

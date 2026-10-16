# Security Specification & Threat Model

## 1. Data Invariants
- **User Identity & Role Elevation**: Non-admin users cannot elevate their role to `admin` or change their status to `approved` when creating or updating their user profile document.
- **Admin Isolation**: Bootstrapped administrator (`bwaimatwaima@gmail.com`) and validated `admin` users have system-wide management access.
- **Reseller Quota & Delegation**: `reseller` users can list and manage user approvals for delegated users, but cannot promote accounts to `admin`.
- **PII & Private API Key Protection**: `users/{userId}/settings/{settingId}` contains user API keys and private configuration that must be accessible ONLY by the document owner or system administrators.
- **Global Settings & Ads Integrity**: `settings/{settingId}` (including `ad_config`) is publicly readable so ad assets load across sessions, but write access is strictly limited to administrators.

## 2. Dirty Dozen Payloads (Adversarial Security Test Vectors)
1. **Self-Promote to Admin**: Standard user attempts `setDoc(users/uid, { role: 'admin', status: 'approved' })`.
2. **Ghost Field Injection**: User attempts adding unexpected shadow permissions field `isSuperAdmin: true` on profile update.
3. **Cross-User API Key Read**: User A attempts `getDoc(users/UserB/settings/apiKeys)`.
4. **Cross-User API Key Overwrite**: User A attempts `setDoc(users/UserB/settings/apiKeys, { userGeminiApiKey: 'stolen' })`.
5. **Unauthorized Ad Hijack**: Non-admin user attempts `setDoc(settings/ad_config, { code: '<script>malicious()</script>' })`.
6. **Email Spoofing Role Claim**: Unverified user with email spoof attempting to bypass ownership.
7. **Credit Inflation Attack**: Non-owner attempts to directly overwrite another user's `credits` count.
8. **Path ID Injection**: ID poisoning with illegal characters in user ID path variables.
9. **User Document Hijack**: User A attempting to modify User B's root `users` document.
10. **Reseller Privilege Escalation**: Reseller attempting to assign themselves the `admin` role.
11. **Malicious Document Deletion**: Non-admin attempting to drop the `settings/ad_config` document.
12. **Blanket Query Scraping**: Unauthenticated user attempting blanket read/query on `users` collection.

## 3. Test Runner Rationale
All rules have been constructed with strict Boolean gates ensuring that all 12 adversarial vectors return `PERMISSION_DENIED`.

# V1.2.8 — Merged Cloud Security Fixes

This package is based on the already-fixed V1.2.8 desktop/export baseline. The five Cloud security recommendations were merged into that baseline rather than replacing those files wholesale.

Merged Cloud changes:
- AI gateway/media/cloud-render route guards and rate limiters
- OpenAI gateway SSRF checks
- Admin model-list HTML escaping
- Firestore render-minute delta mitigation (240-minute bound)
- ALLOWED_ORIGIN_HOST pinning for Cloud Run origins

Existing desktop/export fixes were retained, including dynamic PORT handling, desktop loopback binding, FFmpeg packaging/resolution, capability-token file access, export backpressure protection, FFmpeg timeouts, WebSocket validation, full-write semantics, export validation, temp-file cleanup, cloud-render tokenized downloads, and V1.2.8 version consistency.

Deploy sequence:
1. npm install
2. npm --prefix electron install
3. npm run lint (or the project's TypeScript check)
4. npm test
5. firebase deploy --only firestore:rules
6. redeploy Cloud Run
7. set ALLOWED_ORIGIN_HOST to the exact Cloud Run hostname

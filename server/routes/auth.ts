/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import crypto from 'node:crypto';

const router = express.Router();

let activeDesktopStudioPassword = process.env.DESKTOP_STUDIO_PASSWORD || '';

router.post('/auth/verify-desktop-password', (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ valid: false, error: 'Password required' });
    }

    const expected = activeDesktopStudioPassword;
    if (!expected) {
      // Return 404 with configured: false so the client knows to fall back to Firestore config/hash
      return res.status(404).json({
        valid: false,
        configured: false,
        error: 'Desktop Studio password is not configured on the server.',
      });
    }

    const bufA = Buffer.from(password.trim());
    const bufB = Buffer.from(expected.trim());
    const isMatch = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

    if (isMatch) {
      return res.json({ valid: true, configured: true });
    }
    return res.status(401).json({ valid: false, configured: true, error: 'Incorrect Desktop Studio password' });
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: err.message || 'Verification failed' });
  }
});

router.post('/admin/set-desktop-password', (req, res) => {
  try {
    if (process.env.IS_DESKTOP !== 'true') {
      return res.status(403).json({
        error: 'Desktop password configuration is only permitted in desktop mode (IS_DESKTOP=true).',
      });
    }
    const { newPassword, currentPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length === 0) {
      return res.status(400).json({ error: 'Password cannot be empty' });
    }

    if (activeDesktopStudioPassword) {
      if (!currentPassword || typeof currentPassword !== 'string') {
        return res.status(401).json({ error: 'Current password required to change desktop password' });
      }
      const bufCurr = Buffer.from(currentPassword.trim());
      const bufExp = Buffer.from(activeDesktopStudioPassword.trim());
      const isMatch = bufCurr.length === bufExp.length && crypto.timingSafeEqual(bufCurr, bufExp);
      if (!isMatch) {
        return res.status(403).json({ error: 'Current password does not match' });
      }
    }

    activeDesktopStudioPassword = newPassword.trim();
    const hash = crypto.createHash('sha256').update(activeDesktopStudioPassword).digest('hex');
    return res.json({
      success: true,
      message: 'Desktop Studio password updated on server',
      hash,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update desktop password' });
  }
});

export default router;

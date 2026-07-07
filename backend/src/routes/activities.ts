/**
 * Global activities feed — server-side writer.
 *
 * firestore.rules blocks client-side creates on /activities (`allow create: if
 * false`, CODE_AUDIT_2026-07-04 §S1 — Denial-of-Wallet hardening). This route
 * is the replacement write path used by frontend/src/utils/activityLogger.ts.
 *
 * Identity (`user`, `role`) is derived server-side from the verified ID token
 * and the caller's own user doc — the old client-side logger let any caller
 * spoof both. Payload is Zod-whitelisted and size-capped.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { db } from '../services/firestore';

const CreateActivitySchema = z
  .object({
    type: z.enum(['campaign', 'task', 'comment', 'approval', 'media']),
    action: z.string().min(1).max(120),
    target: z.string().min(1).max(300),
    targetId: z.string().min(1).max(200),
    text: z.string().max(2000).nullable().optional(),
  })
  .strict();

const router = Router();
router.use(requireAuth);

router.post('/', validate(CreateActivitySchema), async (req: AuthedRequest, res: Response, next) => {
  try {
    // Resolve a display name from the caller's own profile doc; fall back to
    // the token email/uid. Never trust a client-supplied name here.
    let displayName = req.email || req.uid!;
    try {
      const snap = await db.collection('users').doc(req.uid!).get();
      const d = snap.data();
      const name = d?.displayName ?? d?.name ?? d?.username;
      if (typeof name === 'string' && name.trim()) displayName = name.trim();
    } catch {
      /* profile lookup is best-effort; email/uid fallback stands */
    }

    const ref = db.collection('activities').doc();
    await ref.set({
      id: ref.id,
      type: req.body.type,
      user: displayName,
      role: req.role,
      action: req.body.action,
      target: req.body.target,
      targetId: req.body.targetId,
      text: req.body.text ?? null,
      time: new Date().toISOString(),
    });
    return res.json({ success: true, id: ref.id });
  } catch (err) {
    next(err);
  }
});

export default router;

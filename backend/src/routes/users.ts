import { Router, Response } from 'express';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { auth, db } from '../services/firestore';

const router = Router();

const VALID_ROLES = ['admin', 'internal', 'agency', 'external_agency', 'media', 'sponsor', 'supplier'];

// Every route below now goes through the same requireAuth middleware as the
// rest of the API (verifies the Firebase ID token AND, in production, the
// Firebase App Check token) instead of a bespoke local verifier. Account
// provisioning is the most sensitive surface in the app; it should not be the
// one place that skips App Check.
router.use(requireAuth);

/**
 * POST /api/users/set-role
 * Admin-only. Role assignment is no longer self-service for ANY role
 * (including 'agency') — every account is created through POST /api/users/create
 * by an admin, which sets the role atomically at creation time. Allowing a
 * caller to self-assign 'agency' was an open self-registration path: any
 * Firebase Auth account (however it was created) could grant itself API access
 * the moment it hit this endpoint. See CODE_AUDIT_2026-07-01.md (H6).
 */
router.post('/set-role', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const { uid, role } = req.body;

    if (!uid || !role) {
      return res.status(400).json({ success: false, error: 'Missing uid or role' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    if (!/^[a-zA-Z0-9]{20,128}$/.test(uid)) {
      return res.status(400).json({ success: false, error: 'Invalid uid format' });
    }

    await auth.setCustomUserClaims(uid, { role });
    await db.collection('users').doc(uid).set({ role }, { merge: true });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error setting custom claim role:', err);
    return res.status((err as any).status || 500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/users/create
 * Admin-only. Creates the Firebase Auth user AND the Firestore profile AND the
 * custom claim in one call, so there is never a window where an authenticated
 * user exists without a provisioned role.
 */
router.post('/create', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const { email: rawEmail, password, displayName, role, agencyName } = req.body;

    if (!password || !displayName || !role) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Email is optional — auto-generate a placeholder if not supplied.
    // Firebase Auth requires an email, so we derive a deterministic internal address.
    const email: string = (rawEmail || '').trim() ||
      `${displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.')}@sosun-fihaara.internal`;

    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });

    await auth.setCustomUserClaims(userRecord.uid, { role });

    const profile: Record<string, any> = {
      uid: userRecord.uid,
      email,
      displayName,
      role,
    };
    if (agencyName) profile.agencyName = agencyName;

    await db.collection('users').doc(userRecord.uid).set(profile);

    return res.json({ success: true, uid: userRecord.uid });
  } catch (err: any) {
    console.error('Error creating user:', err);
    return res.status((err as any).status || 500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/users/:uid
 * Admin-only. An admin cannot delete their own account (avoids accidental
 * self-lockout with no other admin present).
 */
router.delete('/:uid', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const { uid } = req.params;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Missing uid' });
    }
    if (uid === req.uid) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
    }

    await auth.deleteUser(uid).catch((e: any) => {
      if (e.code !== 'auth/user-not-found') throw e;
    });
    await db.collection('users').doc(uid).delete();

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return res.status((err as any).status || 500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/users/roles
 * Any authenticated user may read the static permissions manifest (no
 * sensitive data — describes what the external_agency role can do). Not
 * currently called from the frontend, kept for parity with the API surface.
 */
router.get('/roles', async (_req: AuthedRequest, res: Response) => {
  try {
    const manifest = {
      external_agency: {
        campaigns: {
          view: true,
          create: false,
          edit: false,
          delete: false,
          view_financials: false,
        },
        tasks: {
          view: true,
          create: false,
          edit: false,
          delete: false,
          change_status: 'own_assigned_only',
        },
        checklists: {
          view: true,
          check: 'own_assigned_only',
          create: false,
          edit: false,
          delete: false,
        },
        comments: {
          view: true,
          create: 'own_assigned_only',
          edit: 'own_only_15m',
          delete: false,
          view_internal_only: false,
        },
      },
    };

    return res.json({ success: true, roles: manifest });
  } catch (err: any) {
    console.error('Error fetching roles manifest:', err);
    return res.status((err as any).status || 500).json({ success: false, error: err.message });
  }
});

export default router;

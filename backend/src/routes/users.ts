import { Router } from 'express';
import { auth, db } from '../services/firestore';

const router = Router();

const VALID_ROLES = ['admin', 'internal', 'agency'];

async function verifyToken(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  return auth.verifyIdToken(authHeader.split('Bearer ')[1]);
}

router.post('/set-role', async (req, res) => {
  try {
    const decoded = await verifyToken(req.headers.authorization);
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

    const isSelf = decoded.uid === uid;
    const isAdmin = decoded.role === 'admin';

    if (!isSelf && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (isSelf && !isAdmin && role !== 'agency') {
      return res.status(403).json({ success: false, error: 'Forbidden: self-registration may only set role to agency' });
    }

    await auth.setCustomUserClaims(uid, { role });
    await db.collection('users').doc(uid).set({ role }, { merge: true });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error setting custom claim role:', err);
    return res.status((err as any).status || 500).json({ success: false, error: err.message });
  }
});

router.post('/create', async (req, res) => {
  try {
    const decoded = await verifyToken(req.headers.authorization);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden: admin only' });
    }

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

router.delete('/:uid', async (req, res) => {
  try {
    const decoded = await verifyToken(req.headers.authorization);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden: admin only' });
    }

    const { uid } = req.params;
    if (!uid) {
      return res.status(400).json({ success: false, error: 'Missing uid' });
    }
    if (uid === decoded.uid) {
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

export default router;

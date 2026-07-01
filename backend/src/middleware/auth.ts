import { Request, Response, NextFunction } from 'express';
import { auth, appCheck } from '../services/firestore';

export type AppRole = 'admin' | 'internal' | 'agency' | 'external_agency' | 'media' | 'sponsor' | 'supplier';

// Augment Express Request with the decoded auth context
export interface AuthedRequest extends Request {
  uid?: string;
  role?: AppRole;
  email?: string;
  appCheckToken?: string;
}

/**
 * Verifies the Firebase ID token sent in the Authorization header and
 * attaches { uid, role, email } to the request. Mirrors the inline check
 * already used in routes/users.ts, factored out for reuse.
 * Also verifies the Firebase App Check token if strictly required.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  // 1. Verify App Check Token
  // Note: in local dev it may be omitted unless using debug tokens.
  const appCheckToken = req.header('X-Firebase-AppCheck');
  if (!appCheckToken) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ success: false, error: 'Unauthorized: Missing App Check token' });
    }
  } else {
    try {
      await appCheck.verifyToken(appCheckToken);
    } catch (err: any) {
      console.error('App Check verification failed:', err.message);
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid App Check token' });
    }
  }

  // 2. Verify Auth Token
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    const role = decoded.role as AppRole | undefined;
    // A valid ID token with NO role claim means this Firebase Auth account was
    // never provisioned by an admin — every account created via
    // POST /api/users/create gets its custom claim set atomically at creation
    // time (see routes/users.ts). The only way to reach this state is a
    // Firebase Auth account created outside the app (e.g. self-serve
    // Email/Password sign-up hit directly, bypassing the UI). Previously this
    // fell back to 'agency', silently granting API access to any such
    // account. Reject instead — fail closed rather than least-privilege
    // default. See CODE_AUDIT_2026-07-01.md (H6 residual gap).
    if (!role) {
      return res.status(403).json({
        success: false,
        error: 'Account not provisioned. Contact your administrator.',
      });
    }
    req.uid = decoded.uid;
    req.email = decoded.email;
    req.role = role;
    next();
  } catch (err: any) {
    console.error('Auth verification failed:', err.message);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
}

/** Restricts a route to a set of roles. Use after requireAuth. */
export function requireRole(...roles: AppRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

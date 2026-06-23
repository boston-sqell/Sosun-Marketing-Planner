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
    req.uid = decoded.uid;
    req.email = decoded.email;
    req.role = (decoded.role as AppRole) || 'agency'; // Least-privilege default
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

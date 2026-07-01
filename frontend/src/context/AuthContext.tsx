import React, { createContext, useContext, useState, useEffect } from 'react';
import {
   onAuthStateChanged,
   onIdTokenChanged,
   signInWithEmailAndPassword,
   signOut,
   sendEmailVerification,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserRole, UserProfile } from '../types';

// The verification email link will redirect back to the live app URL.
// Using window.location.origin makes this work on localhost AND production
// without hardcoding a domain.
const emailVerificationSettings = {
  url: `${window.location.origin}/`,
  handleCodeInApp: false,
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  role: UserRole | null;
  error: string | null;
  emailVerified: boolean;
  /** True once we've confirmed the authenticated user has no provisioned
   *  Firestore profile/role. Accounts are only ever created by an admin via
   *  the Configuration page (which sets the profile + custom claim in one
   *  atomic call), so this indicates an account that was never provisioned. */
  unprovisioned: boolean;
  resendVerification: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [unprovisioned, setUnprovisioned] = useState(false);
  // Authoritative role comes from the VERIFIED custom claim on the ID token, not
  // the Firestore profile doc (which a user can edit on their own record).
  const [claimRole, setClaimRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setError(null);

      if (firebaseUser) {
        setUser(firebaseUser);
        setEmailVerified(firebaseUser.emailVerified);
        setUnprovisioned(false);
        try {
          // Fetch additional profile data from Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDocSnap = await getDoc(userDocRef);

          if (userDocSnap.exists()) {
            const data = userDocSnap.data() as UserProfile;
            // Merge in displayName from Firebase Auth if Firestore doc is missing it
            if (!data.displayName) {
              data.displayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
            }
            setProfile(data);
          } else {
            // No profile doc and (see below) no role claim: every account is
            // now provisioned exclusively by an admin via POST /api/users/create,
            // which writes the Firestore profile, the custom claim, and the
            // Auth user atomically. There is deliberately no client-side
            // fallback that self-assigns a role here anymore — that was an
            // open self-registration path (any Firebase Auth account could
            // grant itself 'agency' access). See CODE_AUDIT_2026-07-01.md (H6).
            setProfile(null);
            setUnprovisioned(true);
          }
        } catch (err) {
          console.error('Error loading user profile:', err);
          setError(`Could not fetch user profile details: ${(err as Error).message}`);
          setProfile(null);
        }
        // Read the authoritative role from the verified custom claim. Falls
        // back to null if absent (e.g. an unprovisioned account).
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          setClaimRole((tokenResult.claims.role as UserRole) || null);
        } catch {
          setClaimRole(null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setEmailVerified(false);
        setUnprovisioned(false);
        setClaimRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Keep the Firebase token fresh. Firebase refreshes tokens ~5 min before expiry
  // automatically, but this listener fires on each refresh so we stay in sync.
  // Also re-checks emailVerified so the gate lifts as soon as the user clicks
  // the link in another tab (Firebase refreshes the token at that point).
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const tokenResult = await firebaseUser.getIdTokenResult();
        setEmailVerified(firebaseUser.emailVerified);
        setClaimRole((tokenResult.claims.role as UserRole) || null);
      }
    });
    return () => unsub();
  }, []);

  const resendVerification = async () => {
    setError(null);
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser, emailVerificationSettings);
    } catch (err) {
      setError((err as Error).message || 'Could not resend verification email.');
      throw err;
    }
  };

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      // Force token refresh to make sure we load the latest custom claims
      await result.user.getIdToken(true);
    } catch (err) {
      setError((err as Error).message || 'Login failed. Please check your credentials.');
      throw err;
    }
  };

  const logout = async () => {
    setError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      // Authoritative: verified claim first; profile.role is only a display
      // fallback during the brief window before the token result resolves.
      role: claimRole ?? (profile ? profile.role : null),
      error,
      emailVerified,
      unprovisioned,
      resendVerification,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

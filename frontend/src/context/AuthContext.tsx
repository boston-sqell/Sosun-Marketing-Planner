import React, { createContext, useContext, useState, useEffect } from 'react';
import {
   onAuthStateChanged,
   onIdTokenChanged,
   signInWithEmailAndPassword,
   signOut,
   createUserWithEmailAndPassword,
   sendEmailVerification,
   updateProfile,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
  resendVerification: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string, role: UserRole) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
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
        try {
          // Fetch additional profile data from Firestore
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          let userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            const data = userDocSnap.data() as UserProfile;
            // Merge in displayName from Firebase Auth if Firestore doc is missing it
            // (can happen during the registration race window before setDoc completes)
            if (!data.displayName) {
              data.displayName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User';
            }
            setProfile(data);
          } else {
            // First time login fallback: auto-create user profile and claim on backend
            const email = firebaseUser.email || '';
            const defaultRole: UserRole = 'agency'; // Default to external agency — admins can promote later
            
            const idToken = await firebaseUser.getIdToken();
            const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
            
            const response = await fetch(`${backendUrl}/api/users/set-role`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
              },
              body: JSON.stringify({ uid: firebaseUser.uid, role: defaultRole })
            });

            if (!response.ok) {
              throw new Error('Could not initialize custom claims on backend');
            }

            // Force reload token to get new claim
            await firebaseUser.getIdToken(true);

            // Fetch the newly created document
            userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
              setProfile(userDocSnap.data() as UserProfile);
            } else {
              setProfile({
                uid: firebaseUser.uid,
                email,
                displayName: firebaseUser.displayName || email.split('@')[0] || 'User',
                role: defaultRole
              });
            }
          }
        } catch (err) {
          console.error('Error loading user profile:', err);
          setError(`Could not fetch user profile details: ${(err as Error).message}`);
          
          const email = firebaseUser.email || '';
          setProfile({
            uid: firebaseUser.uid,
            email: email,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
            role: 'agency' // Fallback to external agency — admins can promote later
          });
        }
        // Read the authoritative role from the verified custom claim (refreshed
        // above if a claim was just provisioned). Falls back to null if absent.
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

  const register = async (email: string, password: string, name: string, targetRole: UserRole) => {
    setError(null);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);

      // Set displayName on the Firebase Auth profile immediately so that any
      // onAuthStateChanged fallback that fires before Firestore is written
      // can still read the correct name from firebaseUser.displayName.
      await updateProfile(result.user, { displayName: name }).catch((e) =>
        console.warn('Could not set Firebase Auth displayName:', e)
      );

      // Send verification email before anything else — best-effort, don't block registration
      await sendEmailVerification(result.user, emailVerificationSettings).catch((e) =>
        console.warn('Could not send verification email:', e)
      );

      const idToken = await result.user.getIdToken();
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      
      const response = await fetch(`${backendUrl}/api/users/set-role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid: result.user.uid, role: targetRole })
      });

      if (!response.ok) {
        throw new Error('Failed to set role custom claim on server');
      }

      // Force refresh token to get claims
      await result.user.getIdToken(true);

      const userProfile: UserProfile = {
        uid: result.user.uid,
        email,
        displayName: name,
        role: targetRole
      };
      
      if (targetRole === 'agency') {
        userProfile.agencyName = 'Sosun Agency Partner';
      }
      
      // Update user profile in Firestore for all users
      const userDocRef = doc(db, 'users', result.user.uid);
      await setDoc(userDocRef, userProfile, { merge: true });

      setProfile(userProfile);
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
      resendVerification,
      login,
      logout,
      register
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

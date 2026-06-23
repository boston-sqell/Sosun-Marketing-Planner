import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized with service account.');
  } else {
    // If running on GCP / Cloud Run, it will use Application Default Credentials
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    console.log('Firebase Admin initialized with Application Default Credentials.');
  }
} catch (error) {
  console.warn('Firebase Admin already initialized or failed to initialize:', error);
}

export const db = admin.firestore();
export const auth = admin.auth();
export const storage = admin.storage();
export const appCheck = admin.appCheck();

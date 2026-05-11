import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export function initFirebaseAdmin() {
  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        initializeApp({
          credential: cert(serviceAccount)
        });
        console.log("Firebase Admin initialized successfully.");
      } catch (error) {
        console.error("Error parsing FIREBASE_SERVICE_ACCOUNT_KEY:", error);
      }
    } else {
      console.warn("FIREBASE_SERVICE_ACCOUNT_KEY not found in environment. Database persistence is disabled until configured.");
    }
  }
}

export const getDb = () => {
  if (getApps().length === 0) {
    return null;
  }
  return getFirestore();
};

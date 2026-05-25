import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';

let db: any = null;

try {
  const configPath = join(process.cwd(), 'firebase-applet-config.json');
  const firebaseConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
} catch (err) {
  console.log('Firebase config not found or invalid.');
}

export const waitForAuth = async () => {};

export { db };

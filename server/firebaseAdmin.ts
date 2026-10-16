import fs from 'node:fs';
import path from 'node:path';
import { getApps, initializeApp, cert, type App, type AppOptions } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

let app: App | null = null;
let db: Firestore | null = null;
let authAdmin: Auth | null = null;

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
}

function loadAppletConfig(): FirebaseAppletConfig {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[firebaseAdmin] Could not read firebase-applet-config.json:', err);
  }
  return {};
}

export function getFirebaseAdmin(): App {
  if (app) return app;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    return app;
  }

  const appletConfig = loadAppletConfig();
  const targetProjectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || appletConfig.projectId;

  const appOptions: AppOptions = {};
  if (targetProjectId) {
    appOptions.projectId = targetProjectId;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const credentials = typeof serviceAccountJson === 'string' && serviceAccountJson.trim().startsWith('{')
        ? JSON.parse(serviceAccountJson)
        : serviceAccountJson;
      app = initializeApp({
        ...appOptions,
        credential: cert(credentials),
      });
    } catch (e) {
      console.warn('[firebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON, falling back to default credentials:', e);
      app = initializeApp(appOptions);
    }
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key file,
    // or Application Default Credentials if running on GCP/Cloud Run/Firebase.
    try {
      app = initializeApp(appOptions);
    } catch (e) {
      console.warn('[firebaseAdmin] initializeApp fallback error:', e);
      app = initializeApp();
    }
  }
  return app;
}

export function getFirestoreDb(): Firestore | null {
  if (db) return db;
  try {
    const adminApp = getFirebaseAdmin();
    const appletConfig = loadAppletConfig();
    const databaseId = process.env.FIREBASE_DATABASE_ID || appletConfig.firestoreDatabaseId;

    if (databaseId && databaseId !== '(default)') {
      db = getFirestore(adminApp, databaseId);
    } else {
      db = getFirestore(adminApp);
    }
    return db;
  } catch (err) {
    console.warn('[firebaseAdmin] Could not initialize Firestore DB:', err);
    return null;
  }
}

export function getFirebaseAuth(): Auth | null {
  if (authAdmin) return authAdmin;
  try {
    const adminApp = getFirebaseAdmin();
    authAdmin = getAuth(adminApp);
    return authAdmin;
  } catch (err) {
    console.warn('[firebaseAdmin] Could not initialize Firebase Auth:', err);
    return null;
  }
}


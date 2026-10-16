import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, EmailAuthProvider, linkWithCredential, updatePassword } from 'firebase/auth';
import { initializeFirestore, getFirestore, doc, getDocFromServer, setLogLevel } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { safeJsonStringify } from './utils-core';

// Suppress noisy Firestore internal stream reconnection warnings which carry circular objects
try {
    setLogLevel('silent');
} catch (e) {}

// Intercept console.warn and console.error to prevent circular objects from reaching iframe serializer
if (typeof window !== 'undefined' && !(window as any).__firestoreConsoleWarningPatched) {
    (window as any).__firestoreConsoleWarningPatched = true;
    const originalConsoleWarn = console.warn.bind(console);
    const originalConsoleError = console.error.bind(console);

    const sanitizeArgs = (args: any[]) => {
        return args.map(a => {
            if (typeof a === 'object' && a !== null) {
                try {
                    return JSON.parse(safeJsonStringify(a));
                } catch {
                    return String(a?.message || a);
                }
            }
            return a;
        });
    };

    console.warn = function(...args: any[]) {
        try {
            originalConsoleWarn(...sanitizeArgs(args));
        } catch {
            originalConsoleWarn(...args.map(a => String(a?.message || a)));
        }
    };

    console.error = function(...args: any[]) {
        try {
            originalConsoleError(...sanitizeArgs(args));
        } catch {
            originalConsoleError(...args.map(a => String(a?.message || a)));
        }
    };
}

// Allow user or admin override for Firebase configuration if default config in firebase-applet-config.json is overridden
const customFirebaseApiKey = (typeof localStorage !== 'undefined' && (localStorage.getItem('custom_firebase_api_key') || localStorage.getItem('firebase_api_key'))) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) ||
    firebaseConfig.apiKey;

const customProjectId = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID) || firebaseConfig.projectId;
const customDatabaseId = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID) || (firebaseConfig as any).firestoreDatabaseId;

const resolvedFirebaseConfig = {
    ...firebaseConfig,
    apiKey: customFirebaseApiKey,
    projectId: customProjectId,
    ...(customDatabaseId ? { firestoreDatabaseId: customDatabaseId } : {})
};

// Initialize Firebase
const app = initializeApp(resolvedFirebaseConfig);

// Initialize Auth with localStorage persistence immediately to prevent iframe refresh logouts
let auth: any;
try {
    const authOptions: any = {};
    if (typeof window !== 'undefined' && typeof window.location !== 'undefined' && typeof (globalThis as any).process?.versions?.node === 'undefined') {
        authOptions.persistence = browserLocalPersistence;
        if (browserPopupRedirectResolver) {
            authOptions.popupRedirectResolver = browserPopupRedirectResolver;
        }
    }
    auth = initializeAuth(app, authOptions);
} catch {
    try {
        auth = initializeAuth(app);
    } catch {
        auth = {} as any;
    }
}

// Initialize Firestore with auto-detection for long polling to prevent connection timeouts
const firestoreSettings = {
    experimentalAutoDetectLongPolling: true,
};

let db: any;
try {
    const databaseId = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
        ? firebaseConfig.firestoreDatabaseId
        : undefined;
    if (databaseId) {
        db = initializeFirestore(app, firestoreSettings, databaseId);
    } else {
        db = initializeFirestore(app, firestoreSettings);
    }
} catch {
    try {
        const databaseId = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)')
            ? firebaseConfig.firestoreDatabaseId
            : undefined;
        db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    } catch (e2) {
        console.warn('Firestore fallback initialization notice:', e2);
    }
}

// Test Firestore connection on boot silently (browser only)
async function testConnection() {
    try {
        await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
        // Silently catch offline/unreachable backend notices
        console.warn("Firestore client operating in offline/local cache mode.");
    }
}
if (typeof window !== 'undefined' && typeof (globalThis as any).process?.versions?.node === 'undefined') {
    testConnection();
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({
    prompt: 'select_account'
});
provider.addScope('email');
provider.addScope('profile');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  let errMessage = 'Unknown Firestore error';
  if (error instanceof Error) {
    errMessage = error.message;
  } else if (typeof error === 'string') {
    errMessage = error;
  } else {
    try {
      errMessage = String(error);
    } catch {
      errMessage = 'Unstringifiable error';
    }
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData ? auth.currentUser.providerData.map((provider: any) => ({
        providerId: String(provider.providerId || ''),
        email: provider.email ? String(provider.email) : null,
      })) : []
    },
    operationType,
    path
  };

  const jsonStr = safeJsonStringify(errInfo);
  if (
    errMessage.includes('Could not reach Cloud Firestore backend') ||
    errMessage.includes('client is offline') ||
    errMessage.includes("Backend didn't respond within 10 seconds") ||
    errMessage.includes('Suspicious activity') ||
    errMessage.includes('Request blocked') ||
    errMessage.includes('blocked for project') ||
    (path && (path === 'settings/public_config' || path === 'settings/ad_config'))
  ) {
    console.warn('Firestore Warning (Offline / Unreachable / Blocked / Public Config):', jsonStr);
  } else {
    console.error('Firestore Error: ', jsonStr);
  }
  return new Error(jsonStr);
}

const functions = getFunctions(app);
const storage = getStorage(app);

export async function uploadBlobToFirebaseStorage(blob: Blob, storagePath: string): Promise<string> {
    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, blob, {
        contentType: blob.type || 'application/octet-stream'
    });
    return await getDownloadURL(snapshot.ref);
}

export { app, auth, db, functions, storage, ref, uploadBytes, getDownloadURL, provider, signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, EmailAuthProvider, linkWithCredential, updatePassword };
export type { User };

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { logger } from '../utils/logger';
// The web API key comes from .env only (gitignored — the real boundary: keeping
// it out of git history). It still reaches the client bundle by design; that's
// Firebase's model, not a leak we can close from here.
const getClientApiKey = (): string =>
  (import.meta.env.VITE_FIREBASE_API_KEY as string) || '';
export const firebaseConfig = {
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || '',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || '',
  apiKey: getClientApiKey(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || '',
  firestoreDatabaseId: (import.meta.env.VITE_FIRESTORE_DB_ID as string) || '',
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || '',
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '',
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Always show the account chooser — sign-out must actually reset the journey
// (otherwise Google silently re-grants the cached session in the popup).
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

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

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  logger.error('Firebase', 'Firestore Error', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      logger.error('Firebase', 'Boot connection test failed — check Firebase configuration');
    }
  }
}

testConnection();

export async function signInWithGoogle(): Promise<User> {
  try {
    logger.info('Auth', 'Initiating Google Sign-In with popup...');
    const result = await signInWithPopup(auth, googleProvider);
    logger.info('Auth', `Google Sign-In successful for: ${result.user.email}`);
    return result.user;
  } catch (error: any) {
    logger.error('Auth', 'Google Sign-In error', { code: error?.code, message: error?.message });
    // Preserve the error CODE on every path: AuthGate classifies on codes, never
    // on message strings. This function throwing bare Errors is what used to
    // break that, so every throw here goes through withCode().
    const withCode = (code: string, message: string): Error & { code: string } => {
      const e = new Error(message) as Error & { code: string };
      e.code = code;
      return e;
    };
    if (error?.code === 'auth/popup-blocked') {
      throw withCode('auth/popup-blocked', 'Sign-in popup was blocked by your browser. Allow popups for this site and try again.');
    }
    if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
      throw withCode(error.code, 'Sign-in was cancelled before completing authorization.');
    }
    if (error?.code === 'auth/unauthorized-domain') {
      throw withCode('auth/unauthorized-domain', `Domain (${window.location.hostname}) is not authorized in Firebase Console → Authentication → Settings → Authorized Domains.`);
    }
    if (error?.code === 'auth/network-request-failed') {
      throw withCode('auth/network-request-failed', 'Network error while reaching Google sign-in.');
    }
    if (error instanceof Error && typeof (error as any).code !== 'string') {
      (error as any).code = 'auth/unknown';
    }
    throw error;
  }
}

export async function logOut(): Promise<void> {
  logger.info('Auth', 'Signing out user...');
  await signOut(auth);
  logger.info('Auth', 'User successfully signed out');
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

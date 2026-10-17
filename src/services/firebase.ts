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
const getClientApiKey = (): string => {
  if (typeof window !== 'undefined') {
    const custom = window.localStorage.getItem('markbrain_firebase_api_key');
    if (custom && custom.trim()) return custom.trim();
  }
  return (import.meta.env.VITE_FIREBASE_API_KEY as string) || '';
};

// Resolve credentials strictly from runtime environment variables or client localStorage
// Zero hardcoded keys or static json files in the codebase
export const firebaseConfig = {
  projectId:
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) ||
    'gen-lang-client-0408097994',
  appId:
    (import.meta.env.VITE_FIREBASE_APP_ID as string) ||
    '1:955271166888:web:3963932837d93e33973b9d',
  apiKey: getClientApiKey(),
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
    'gen-lang-client-0408097994.firebaseapp.com',
  firestoreDatabaseId:
    (import.meta.env.VITE_FIRESTORE_DB_ID as string) ||
    'ai-studio-markbrainarchite-a0ee634f-b8e1-4ef3-9873-5a0c2410dfc2',
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
    'gen-lang-client-0408097994.firebasestorage.app',
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) ||
    '955271166888',
};

export function saveCustomApiKey(newKey: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('markbrain_firebase_api_key', newKey.trim());
    window.location.reload();
  }
}

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Firestore with specific database ID if configured
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot per Firebase skill guidelines
export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

// Authentication helper methods
export async function signInWithGoogle(): Promise<User> {
  try {
    console.log('[MarkBrain:Auth] Initiating Google Sign-In with popup...');
    const result = await signInWithPopup(auth, googleProvider);
    console.log('[MarkBrain:Auth] Google Sign-In successful for:', result.user.email);
    return result.user;
  } catch (error: any) {
    console.error('[MarkBrain:Auth] Google Sign-In error:', error?.code, error?.message);
    if (error?.code === 'auth/popup-blocked') {
      throw new Error('Sign-in popup was blocked by your browser. Please allow popups for this site and try again.');
    }
    if (error?.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign-in popup was closed before completing authorization.');
    }
    if (error?.code === 'auth/unauthorized-domain') {
      throw new Error(`Domain (${window.location.hostname}) is not authorized in Firebase Console -> Authentication -> Settings -> Authorized Domains.`);
    }
    throw error;
  }
}

export async function logOut(): Promise<void> {
  console.log('[MarkBrain:Auth] Signing out user...');
  await signOut(auth);
  console.log('[MarkBrain:Auth] User successfully signed out');
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

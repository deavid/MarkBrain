import type { Express, Request, Response } from 'express';

export function registerAuthRoutes(app: Express): void {
// API: Firebase / OAuth client configuration from runtime environment
app.get('/api/auth/config', (_req: Request, res: Response) => {
  res.json({
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    appId: process.env.FIREBASE_APP_ID || '',
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || (process.env.FIREBASE_PROJECT_ID ? `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    firestoreDatabaseId: process.env.FIRESTORE_DB_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID || '',
    oAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    // Google Picker "developer key" (API key). Client-side by design — restrict
    // it by referrer in Google Cloud Console.
    pickerApiKey: process.env.GOOGLE_PICKER_API_KEY || '',
  });
});
}

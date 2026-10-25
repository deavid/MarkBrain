import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import dotenv from 'dotenv';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  // Same env layering as server.ts (see there for the precedence rules):
  // standalone `vite build` doesn't pass through server.ts, so load the
  // files here too. When run under `npm run dev` server.ts already
  // populated process.env → no-op.
  // import.meta.dirname, not __dirname — the native ESM config loader (Vite's
  // future default) has no __dirname and warns about it on every boot.
  dotenv.config({ path: path.resolve(import.meta.dirname, '.env'), quiet: true });
  dotenv.config({ path: path.resolve(import.meta.dirname, '.env.shared'), quiet: true });
  dotenv.config({
    path: path.resolve(import.meta.dirname, '../MarkBrain/.env.markbrain-main.shared'),
    quiet: true,
  });

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || ''),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || ''),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || ''),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || ''),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || ''),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
      // Not verified. The whole BYOK UI is behind this so it cannot be shipped
      // as working while the model itself is still unsettled. Set VITE_BYOK=1
      // to look at it. Default off.
      'import.meta.env.VITE_BYOK': JSON.stringify(process.env.VITE_BYOK || ''),
      'import.meta.env.VITE_FIRESTORE_DB_ID': JSON.stringify(process.env.FIRESTORE_DB_ID || process.env.VITE_FIRESTORE_DB_ID || ''),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

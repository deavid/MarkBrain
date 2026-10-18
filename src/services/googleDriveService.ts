import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  Auth,
} from 'firebase/auth';
import { logger } from '../utils/logger';

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let providerInstance: GoogleAuthProvider | null = null;

interface AuthConfig {
  apiKey?: string;
  projectId?: string;
  authDomain?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  pickerApiKey?: string;
}

let cachedAuthConfig: AuthConfig | null = null;

async function fetchAppConfig(): Promise<AuthConfig | null> {
  if (cachedAuthConfig) return cachedAuthConfig;
  try {
    const res = await fetch('/api/auth/config');
    if (!res.ok) return null;
    cachedAuthConfig = (await res.json()) as AuthConfig;
    return cachedAuthConfig;
  } catch {
    return null;
  }
}

// Helper to initialize Firebase App from server environment config
async function getOrInitAuth(): Promise<Auth | null> {
  if (authInstance) return authInstance;
  try {
    const config = await fetchAppConfig();
    if (!config || !config.apiKey || !config.projectId) {
      // Configuration not provided in environment
      return null;
    }
    if (getApps().length === 0) {
      appInstance = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      });
    } else {
      appInstance = getApps()[0];
    }
    authInstance = getAuth(appInstance);
    return authInstance;
  } catch (e) {
    logger.warn('Drive', 'Failed to initialize Firebase Auth from environment config', e);
    return null;
  }
}

function getProvider(): GoogleAuthProvider {
  if (providerInstance) return providerInstance;
  providerInstance = new GoogleAuthProvider();
  providerInstance.addScope('https://www.googleapis.com/auth/drive.readonly');
  providerInstance.addScope('https://www.googleapis.com/auth/documents.readonly');
  providerInstance.setCustomParameters({
    prompt: 'consent',
    access_type: 'offline',
  });
  return providerInstance;
}

// In-memory token cache (never stored in localStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  let unsubscribeFn = () => {};
  getOrInitAuth().then((auth) => {
    if (!auth) {
      if (onAuthFailure) onAuthFailure();
      return;
    }
    unsubscribeFn = onAuthStateChanged(auth, async (user: User | null) => {
      if (user && cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    });
  });

  return () => {
    unsubscribeFn();
  };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const auth = await getOrInitAuth();
    if (!auth) {
      throw new Error(
        'Google Auth is not configured. Please supply the auth configuration via environment variables (FIREBASE_API_KEY, FIREBASE_PROJECT_ID) instead of committing secrets.'
      );
    }
    const provider = getProvider();
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive/Docs access token from authentication');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    logger.error('Drive', 'Google sign-in error', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const googleSignOut = async () => {
  if (authInstance) {
    await signOut(authInstance);
  }
  cachedAccessToken = null;
};

/**
 * Full disconnect + fresh sign-in. Used to recover from "insufficient
 * authentication scopes": Google reused an older, narrower grant for this
 * app (e.g. the basic AuthGate login) and never offered the Drive consent.
 */
export const googleReconnect = async (): Promise<{ user: User; accessToken: string } | null> => {
  await googleSignOut();
  return googleSignIn();
};

// drive.readonly covers list/download/export; documents.readonly only upgrades
// the optional Docs-API AST fallback path, so it's not gated on here.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface ScopeVerification {
  /** true when the access token actually carries Drive read access */
  granted: boolean;
  /** all scopes the token carries (empty when not checked) */
  scopes: string[];
  /** false when the check itself failed (offline etc.) — stay optimistic */
  checked: boolean;
}

/**
 * Verifies the granted scopes of a Google access token via the tokeninfo
 * endpoint. Prevents the confusing UX where we show "Connected" but every
 * Drive call 403s with "Request had insufficient authentication scopes".
 */
export async function verifyDriveScopes(accessToken: string): Promise<ScopeVerification> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) {
      // Invalid/expired token — reconnect is the correct remedy either way.
      return { granted: false, scopes: [], checked: true };
    }
    const data = await res.json().catch(() => ({}) as { scope?: string });
    const scopes = typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : [];
    // Drive list/download/export all need drive.readonly; documents.readonly
    // only upgrades the (optional) Docs-API AST fallback path.
    return { granted: scopes.includes(DRIVE_SCOPE), scopes, checked: true };
  } catch {
    return { granted: true, scopes: [], checked: false };
  }
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  isGoogleDoc?: boolean;
}

/**
 * Extracts Google Document ID from a shared URL or raw ID string
 */
export function extractGoogleDocIdFromUrl(input: string): string | null {
  if (!input || !input.trim()) return null;
  const trimmed = input.trim();
  // Standard Google Docs URL: /document/d/<id>/
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]{25,})/);
  if (match) {
    return match[1];
  }
  // Drive file URL: /file/d/<id>/
  const driveMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
  if (driveMatch) {
    return driveMatch[1];
  }
  // Raw ID check (typically 30-50 chars alphanumeric with - and _)
  if (/^[a-zA-Z0-9_-]{25,70}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google Picker — Google's own hosted file-selection dialog.
// Replaces the hand-rolled in-app Drive file list: the user browses/searches
// inside a real Google popup, picks a file, and we get the id back here.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Feature flag: the Google Picker path is shelved for now (developer-key
 * issues on localhost; paste-a-link import is the working path). Opt in with
 * VITE_GOOGLE_PICKER_ENABLED=true in .env and a server restart.
 */
export const isGooglePickerEnabled = (): boolean =>
  (import.meta.env.VITE_GOOGLE_PICKER_ENABLED as string | undefined) === 'true';

let pickerLoadPromise: Promise<void> | null = null;

function loadGooglePickerApi(): Promise<void> {
  if (pickerLoadPromise) return pickerLoadPromise;

  pickerLoadPromise = new Promise<void>((resolve, reject) => {
    const startGapiLoad = () => {
      const gapi = window.gapi;
      if (!gapi) {
        reject(new Error('Google API script loaded but gapi is missing'));
        return;
      }
      gapi.load('picker', {
        callback: () => resolve(),
        ontimeout: () => reject(new Error('Google Picker failed to initialize (timeout)')),
        timeout: 15000,
      });
    };

    if (window.gapi) {
      startGapiLoad();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = startGapiLoad;
    script.onerror = () =>
      reject(
        new Error(
          'Failed to load https://apis.google.com/js/api.js — check your network or content blocker.'
        )
      );
    document.head.appendChild(script);
  });

  // Allow a retry after a failed load attempt.
  pickerLoadPromise.catch(() => {
    pickerLoadPromise = null;
  });

  return pickerLoadPromise;
}

async function getPickerApiKey(): Promise<string> {
  const fromEnv = (import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string) || '';
  if (fromEnv) return fromEnv;
  const config = await fetchAppConfig();
  return config?.pickerApiKey || '';
}

/**
 * Opens Google's hosted file picker and resolves with the chosen file,
 * or null if the user cancelled.
 *
 * Requires an access token carrying `drive.readonly` (verify with
 * verifyDriveScopes first) and a Picker API key (GOOGLE_PICKER_API_KEY).
 */
export async function openGooglePicker(accessToken: string): Promise<PickedDriveFile | null> {
  if (!isGooglePickerEnabled()) {
    throw new Error('Google Picker is disabled in this build (unfinished feature). Paste a Google Doc link instead.');
  }
  await loadGooglePickerApi();

  const apiKey = await getPickerApiKey();
  if (!apiKey) {
    throw new Error(
      "Google Picker isn't configured: set GOOGLE_PICKER_API_KEY in the server environment " +
        '(Google Cloud Console → APIs & Services → Credentials → API key, restricted to this site’s referrer) ' +
        'and restart the server. Until then, you can paste a Google Doc link below.'
    );
  }

  // The picker module registers itself on the `google` global
  // (google.picker.PickerBuilder …); `gapi` is only the loader. Some builds
  // also expose a (possibly partial) gapi.picker — accept either, then
  // verify the members we need actually exist before touching them.
  const ns: any = window.google?.picker ?? window.gapi?.picker;
  if (!ns?.PickerBuilder || !ns?.ViewId?.DOCS || !ns?.DocsView) {
    throw new Error(
      'Google Picker loaded but its API namespace is incomplete (expected google.picker with ' +
        'PickerBuilder/ViewId/DocsView). Try again — if it persists, check that ' +
        'apis.google.com/js/api.js and the picker module are not blocked by an extension.'
    );
  }

  return new Promise<PickedDriveFile | null>((resolve, reject) => {
    try {
      const docsView = new ns.DocsView(ns.ViewId.DOCS)
        .setMimeTypes('application/vnd.google-apps.document,text/markdown,text/plain')
        .setMode(ns.DocsViewMode.LIST);

      const builder = new ns.PickerBuilder()
        .setTitle('Select a Google Doc or Markdown file')
        .addView(docsView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setOrigin(window.location.origin)
        .setCallback((data: { action?: string; docs?: Array<Record<string, string>>; errorMessage?: string }) => {
          switch (data?.action) {
            case ns.Action.PICKED: {
              const doc = data.docs?.[0];
              if (doc?.id) {
                resolve({
                  id: doc.id,
                  name: doc.name || 'Untitled document',
                  mimeType: doc.mimeType || '',
                });
              } else {
                resolve(null);
              }
              break;
            }
            case ns.Action.CANCEL:
              resolve(null);
              break;
            case ns.Action.LOADED:
            case 'loading':
              break;
            default:
              // Error/unknown actions — dismiss rather than hang the caller.
              if (data?.errorMessage) {
                reject(new Error(`Google Picker error: ${data.errorMessage}`));
              } else {
                resolve(null);
              }
              break;
          }
        });

      builder.build().setVisible(true);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Failed to open Google Picker'));
    }
  });
}

/**
 * Converts Google Docs document AST (from Docs API v1) to clean Markdown
 */
export function convertGoogleDocAstToMarkdown(doc: any): string {
  if (!doc || !doc.body || !doc.body.content) {
    return '';
  }

  const lines: string[] = [];
  const content = doc.body.content;

  for (const element of content) {
    if (element.paragraph) {
      const p = element.paragraph;
      const namedStyle = p.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
      let paragraphText = '';

      if (p.elements) {
        for (const el of p.elements) {
          if (el.textRun) {
            const text = el.textRun.content || '';
            const style = el.textRun.textStyle || {};
            const trailingNewlines = text.match(/\n+$/)?.[0] || '';
            const coreText = text.replace(/\n+$/, '');

            if (coreText.length > 0) {
              let formatted = coreText;
              if (style.bold && style.italic) {
                formatted = `***${formatted}***`;
              } else if (style.bold) {
                formatted = `**${formatted}**`;
              } else if (style.italic) {
                formatted = `*${formatted}*`;
              }
              if (style.link && style.link.url) {
                formatted = `[${formatted}](${style.link.url})`;
              }
              paragraphText += formatted + trailingNewlines;
            } else {
              paragraphText += text;
            }
          }
        }
      }

      // Check bullet list item
      if (p.bullet) {
        const bulletPrefix = p.bullet.listId ? '* ' : '- ';
        lines.push(bulletPrefix + paragraphText.trim());
        continue;
      }

      // Apply Heading Styles
      const cleanText = paragraphText.trim();
      if (!cleanText) {
        lines.push('');
        continue;
      }

      switch (namedStyle) {
        case 'TITLE':
          lines.push(`# ${cleanText}\n`);
          break;
        case 'SUBTITLE':
          lines.push(`> ${cleanText}\n`);
          break;
        case 'HEADING_1':
          lines.push(`\n# ${cleanText}\n`);
          break;
        case 'HEADING_2':
          lines.push(`\n## ${cleanText}\n`);
          break;
        case 'HEADING_3':
          lines.push(`\n### ${cleanText}\n`);
          break;
        case 'HEADING_4':
          lines.push(`\n#### ${cleanText}\n`);
          break;
        case 'HEADING_5':
          lines.push(`\n##### ${cleanText}\n`);
          break;
        default:
          lines.push(cleanText);
          break;
      }
    } else if (element.table) {
      const table = element.table;
      if (table.tableRows) {
        lines.push('\n');
        table.tableRows.forEach((row: any, rIdx: number) => {
          const cells = (row.tableCells || []).map((cell: any) => {
            let cellText = '';
            (cell.content || []).forEach((cEl: any) => {
              (cEl.paragraph?.elements || []).forEach((el: any) => {
                if (el.textRun?.content) cellText += el.textRun.content.trim() + ' ';
              });
            });
            return cellText.trim() || '-';
          });
          lines.push(`| ${cells.join(' | ')} |`);
          if (rIdx === 0) {
            lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
          }
        });
        lines.push('\n');
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Direct fetch of a Google Doc by ID via Google Docs API v1 or Drive export
 */
export async function fetchGoogleDocById(
  accessToken: string,
  documentId: string
): Promise<{ title: string; markdown: string }> {
  try {
    // 1. First try: Google Docs API v1 (most accurate structure with headings)
    const docsApiUrl = `https://docs.googleapis.com/v1/documents/${documentId}`;
    const docRes = await fetch(docsApiUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (docRes.ok) {
      const docData = await docRes.json();
      const title = docData.title || 'Imported Google Doc';
      const markdown = convertGoogleDocAstToMarkdown(docData);
      if (markdown.trim().length > 0) {
        return { title, markdown };
      }
    }

    // 2. Second try: Drive export endpoint with text/markdown
    const exportMdUrl = `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=text/markdown`;
    const mdRes = await fetch(exportMdUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (mdRes.ok) {
      const mdText = await mdRes.text();
      return { title: 'Imported Google Doc', markdown: mdText };
    }

    // 3. Third try: Drive export endpoint with text/plain
    const plainUrl = `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=text/plain`;
    const plainRes = await fetch(plainUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (plainRes.ok) {
      const plainText = await plainRes.text();
      return { title: 'Imported Google Doc', markdown: plainText };
    }

    throw new Error('Unable to read Google Doc. Verify that you have view permissions for this document.');
  } catch (err) {
    logger.error('Drive', 'Failed to fetch Google Doc by ID', err);
    throw err;
  }
}

/**
 * Fetches content of a selected Google Drive or Google Doc file and converts it to Markdown
 */
export async function fetchDriveFileContent(
  accessToken: string,
  file: DriveFileItem
): Promise<{ markdown: string; format: 'native_markdown' | 'gdoc_exported' | 'gdoc_ast' | 'text' }> {
  try {
    // 1. Handling Google Docs
    if (file.mimeType === 'application/vnd.google-apps.document') {
      // First try: Native Drive API export to text/markdown
      try {
        const exportMdUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/markdown`;
        const mdRes = await fetch(exportMdUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (mdRes.ok) {
          const text = await mdRes.text();
          if (text && text.trim().length > 0) {
            return { markdown: text, format: 'gdoc_exported' };
          }
        }
      } catch (e) {
        logger.warn('Drive', 'Native markdown export unavailable — falling back to Docs API AST parsing', e);
      }

      // Second try: Google Docs API v1 AST document fetch and structured Markdown conversion
      try {
        const docsApiUrl = `https://docs.googleapis.com/v1/documents/${file.id}`;
        const docRes = await fetch(docsApiUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (docRes.ok) {
          const docData = await docRes.json();
          const markdown = convertGoogleDocAstToMarkdown(docData);
          if (markdown.trim().length > 0) {
            return { markdown, format: 'gdoc_ast' };
          }
        }
      } catch (e) {
        logger.warn('Drive', 'Docs API fetch failed — falling back to text/plain export', e);
      }

      // Third try: plain text export
      const plainUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
      const plainRes = await fetch(plainUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (plainRes.ok) {
        const plainText = await plainRes.text();
        return { markdown: plainText, format: 'text' };
      }

      throw new Error('Unable to export or read Google Doc content');
    }

    // 2. Regular Drive file (e.g. .md, .txt)
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    const res = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download file from Google Drive: ${res.statusText}`);
    }

    const text = await res.text();
    return { markdown: text, format: 'native_markdown' };
  } catch (err) {
    logger.error('Drive', 'Failed to fetch Drive file content', err);
    throw err;
  }
}

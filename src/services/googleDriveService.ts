import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Request both Google Drive read-only and Google Docs read-only scopes
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/documents.readonly');
// Force consent prompt if user needs to refresh scopes
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

// In-memory token cache (never stored in localStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Drive/Docs access token from authentication');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const googleSignOut = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  isGoogleDoc?: boolean;
}

export type DriveFilterType = 'all' | 'docs' | 'markdown';

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

/**
 * Lists files from Google Drive, prioritizing Google Docs and Markdown/Text files
 * Features resilient query fallbacks and client-side filtering
 */
export async function listDriveFiles(
  accessToken: string,
  query: string = '',
  filter: DriveFilterType = 'all'
): Promise<DriveFileItem[]> {
  try {
    // Build compliant Google Drive API v3 query
    let mimeFilter = "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/plain' or mimeType = 'text/markdown')";
    if (filter === 'docs') {
      mimeFilter = "mimeType = 'application/vnd.google-apps.document'";
    } else if (filter === 'markdown') {
      mimeFilter = "(mimeType = 'text/plain' or mimeType = 'text/markdown')";
    }

    let q = `trashed = false and ${mimeFilter}`;
    // Sanitize query string - Drive API 'name contains' only supports alphanumeric words
    const cleanWord = query.trim().replace(/[^a-zA-Z0-9_-]/g, '').trim();
    if (cleanWord) {
      q += ` and name contains '${cleanWord}'`;
    }

    const fetchFiles = async (queryString: string) => {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', queryString);
      url.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, size)');
      url.searchParams.set('orderBy', 'modifiedTime desc');
      url.searchParams.set('pageSize', '40');

      return await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    };

    let res = await fetchFiles(q);

    // If query failed with 400 (e.g. strict query syntax restriction on user account), retry with simple query
    if (!res.ok && res.status === 400) {
      console.warn('Drive query with mimeType returned 400, falling back to simple trashed=false query');
      res = await fetchFiles('trashed = false');
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const detail = errBody?.error?.message || res.statusText || 'Unknown Drive API error';
      if (res.status === 401) {
        cachedAccessToken = null;
        throw new Error('Your Google authorization has expired. Please sign in again.');
      }
      if (res.status === 403) {
        throw new Error(`Google Drive access error: ${detail}`);
      }
      throw new Error(`Google Drive API error (${res.status}): ${detail}`);
    }

    const data = await res.json();
    const rawFiles: any[] = data.files || [];

    // Client-side filtering & annotation
    const files: DriveFileItem[] = rawFiles
      .filter((f) => {
        const isDoc = f.mimeType === 'application/vnd.google-apps.document';
        const isMd =
          f.mimeType === 'text/markdown' ||
          f.mimeType === 'text/plain' ||
          (f.name && (f.name.endsWith('.md') || f.name.endsWith('.txt') || f.name.endsWith('.markdown')));

        if (filter === 'docs') return isDoc;
        if (filter === 'markdown') return isMd;
        return isDoc || isMd;
      })
      .map((f) => ({
        id: f.id,
        name: f.name || 'Untitled Document',
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        size: f.size,
        isGoogleDoc: f.mimeType === 'application/vnd.google-apps.document',
      }));

    return files;
  } catch (err) {
    console.error('Failed to list Drive files:', err);
    throw err;
  }
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
    console.error('Failed to fetch Google Doc by ID:', err);
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
        console.warn('Native markdown export not available, falling back to Docs API AST parsing:', e);
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
        console.warn('Google Docs API fetch failed, trying text/plain export:', e);
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
    console.error('Failed to fetch Drive file content:', err);
    throw err;
  }
}

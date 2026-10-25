/**
 * Export scrub (design-docs/16 §4.2 Tier 1 rule 1 + Phase 2 item 3): user API
 * keys live in localStorage (`markbrain:keys:*`) and must NEVER appear in
 * anything export-shaped. These tests feed a storage seeded with keys through
 * the real export serializers and assert the key material is absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeDatabase, parseDatabaseExport } from '../services/persistenceService';
import { exportToJSON, exportToMarkdown, exportToYAML } from '../utils/tokenCalculator';
import { setKeySlot, getKeySlot } from '../data/keySlots';
import { setByokEnabledForTests } from '../data/byokFlag';

const SECRET_FREE = 'AIza-SECRET-FREE-KEY-123';
const SECRET_PAID = 'AIza-SECRET-PAID-KEY-456';
const SECRET_OR = 'sk-or-SECRET-OPENROUTER-789';

function stubWindowWithKeys() {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    },
    location: { search: '' },
  });
  return storage;
}

beforeEach(() => {
  setByokEnabledForTests(true); // this suite exercises real key storage
});

afterEach(() => {
  setByokEnabledForTests(false);
  vi.unstubAllGlobals();
});

function seedKeys() {
  setKeySlot('gemini-free', SECRET_FREE);
  setKeySlot('gemini-paid', SECRET_PAID);
  setKeySlot('openrouter', SECRET_OR);
  expect(getKeySlot('gemini-free')).toBe(SECRET_FREE); // sanity: seeding worked
}

function sampleProject() {
  return {
    meta: {
      id: 'proj-1',
      name: 'Test Project',
      codeName: 'test',
      description: 'A project about birds',
    },
    artifacts: [
      {
        id: 'art-1',
        code: 'bird-note',
        type: 'note',
        isHighConcept: false,
        title: 'Kestrel notes',
        current: {
          subtitle: 'A bird',
          description: 'Birds are real',
          summary: 'Summary of birds',
          body: 'The kestrel hovers.',
        },
      },
    ],
    chapters: [
      {
        chapter: { title: 'Ch 1', summary: 'We talked about birds' },
        turns: [{ role: 'user', content: 'Tell me about kestrels', timestamp: 1700000000000 }],
      },
    ],
    edges: [],
  };
}

function sampleSnapshot() {
  return {
    projectId: 'proj-1',
    name: 'Test Project',
    artifacts: [
      { id: 'art-1', title: 'Kestrel notes', body: 'The kestrel hovers.' },
    ],
    updatedAt: Date.now(),
  } as any;
}

const ALL_SECRETS = [SECRET_FREE, SECRET_PAID, SECRET_OR];

function expectNoSecrets(text: string, where: string) {
  for (const s of ALL_SECRETS) {
    expect(text, `${where} leaked a key`).not.toContain(s);
  }
  // And the storage KEYS themselves must not ride along either.
  expect(text, `${where} leaked a key-slot name`).not.toContain('markbrain:keys:');
}

describe('exports never contain key material', () => {
  it('serializeDatabase (database export) is clean', () => {
    stubWindowWithKeys();
    seedKeys();
    const out = serializeDatabase({
      format: 'markbrain-database',
      version: 1,
      exportedAt: Date.now(),
      backend: 'local',
      projects: [sampleSnapshot()],
    });
    expectNoSecrets(out, 'serializeDatabase');
  });

  it('exportToJSON is clean', () => {
    stubWindowWithKeys();
    seedKeys();
    const proj = sampleProject();
    const out = exportToJSON([proj.meta as any], proj as any);
    expectNoSecrets(out, 'exportToJSON');
  });

  it('exportToMarkdown is clean', () => {
    stubWindowWithKeys();
    seedKeys();
    const out = exportToMarkdown(sampleProject() as any);
    expectNoSecrets(out, 'exportToMarkdown');
  });

  it('exportToYAML is clean', () => {
    stubWindowWithKeys();
    seedKeys();
    const out = exportToYAML(sampleProject() as any);
    expectNoSecrets(out, 'exportToYAML');
  });

  it('parseDatabaseExport output round-trips without dragging keys in', () => {
    stubWindowWithKeys();
    seedKeys();
    const json = serializeDatabase({
      format: 'markbrain-database',
      version: 1,
      exportedAt: Date.now(),
      backend: 'local',
      projects: [sampleSnapshot()],
    });
    const parsed = parseDatabaseExport(json);
    expectNoSecrets(JSON.stringify(parsed), 'parseDatabaseExport');
    // The key STORAGE still exists — scrubbing exports must not nuke the keys.
    expect(getKeySlot('gemini-free')).toBe(SECRET_FREE);
  });
});

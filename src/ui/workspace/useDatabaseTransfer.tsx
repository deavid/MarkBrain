import { useCallback, useRef } from 'react';
import {
  exportDatabase,
  serializeDatabase,
  parseDatabaseExport,
  importDatabase,
  listUserProjects,
  getBackend,
  saveProjectSnapshot,
} from '../../services/persistenceService';
import { exportProjectsTarGz, importProjectTarGz } from '../../domains/plaintextTree';
import { logger } from '../../utils/logger';

export function useDatabaseTransfer() {

  const importDbFileRef = useRef<HTMLInputElement | null>(null);
  const importPlaintextFileRef = useRef<HTMLInputElement | null>(null);

  /** Every project -> one plaintext .tar.gz (Package 3 SS3.5). Works offline. */
  const handleExportPlaintext = useCallback(async () => {
    try {
      const projects = await listUserProjects();
      if (projects.length === 0) {
        alert('Nothing to export yet - create a project first.');
        return;
      }
      const bytes = await exportProjectsTarGz(projects);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `markbrain-plaintext-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      logger.info('App', `Plaintext backup downloaded (${projects.length} project(s) from ${getBackend()})`);
    } catch (err: any) {
      logger.error('App', `Plaintext export failed: ${err?.message || err}`, err);
    }
  }, []);

  /** Import a .tar.gz/.tar plaintext archive; per-project conflict choice. */
  const handleImportPlaintextFile = useCallback(async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const incoming = await importProjectTarGz(bytes);
      if (incoming.length === 0) {
        alert('No projects found in that archive.');
        return;
      }
      const existing = await listUserProjects();
      const existingById = new Map(existing.map((p) => [p.projectId, p]));
      let imported = 0;
      for (const snapshot of incoming) {
        const conflict = existingById.get(snapshot.projectId);
        if (!conflict) {
          await saveProjectSnapshot(snapshot.projectId, snapshot);
          imported++;
          continue;
        }
        const choice = window.prompt(
          `A project named "${conflict.name || conflict.projectId}" already exists.\n\n` +
            `Type "new" to import it as a new copy, "replace" to overwrite the existing one, or anything else to skip it.`,
          'new'
        );
        if (choice === null) continue;
        const normalized = (choice || '').trim().toLowerCase();
        if (normalized === 'new') {
          const suffix = ` (imported ${new Date().toISOString().slice(0, 10)})`;
          const copy = {
            ...snapshot,
            projectId: `${snapshot.projectId}-import-${Date.now().toString(36)}`,
            name: `${snapshot.name || snapshot.projectId}${suffix}`,
          };
          await saveProjectSnapshot(copy.projectId, copy);
          imported++;
        } else if (normalized === 'replace') {
          await saveProjectSnapshot(snapshot.projectId, snapshot);
          imported++;
        }
      }
      logger.info('App', `Plaintext import finished: ${imported}/${incoming.length} project(s) written.`);
      if (imported > 0) {
        window.location.reload();
      }
    } catch (err: any) {
      logger.error('App', `Plaintext import failed: ${err?.message || err}`, err);
      alert(`Plaintext import failed: ${err?.message || err}`);
    }
  }, []);

  const plaintextImportInput = (
    <input
      ref={importPlaintextFileRef}
      type="file"
      accept=".tar.gz,.tgz,.tar,application/gzip,application/x-tar"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void handleImportPlaintextFile(f);
        e.target.value = '';
      }}
    />
  );

  const handleExportDatabase = useCallback(async () => {
    try {
      const data = await exportDatabase();
      const blob = new Blob([serializeDatabase(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `markbrain-db-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      logger.info('App', `Database backup downloaded (${data.projects.length} projects)`);
    } catch (err: any) {
      logger.error('App', `Database export failed: ${err?.message || err}`, err);
    }
  }, []);

  const handleImportDatabaseFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseDatabaseExport(text);
      const n = await importDatabase(parsed);
      logger.info('App', `Database restore OK — ${n} project(s) imported. Reloading…`);
      // Fresh boot is the honest way to show restored data: the boot path
      // (gate → project list → snapshot load) is the one already exercised
      // by every session, fixture, and real-data run.
      window.location.reload();
    } catch (err: any) {
      logger.error('App', `Database import failed: ${err?.message || err}`, err);
      alert(`Import failed: ${err?.message || err}`);
    }
  }, []);

  const dbImportInput = (
    <input
      ref={importDbFileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleImportDatabaseFile(f);
        e.target.value = '';
      }}
    />
  );

  return { importDbFileRef, handleExportDatabase, handleImportDatabaseFile, dbImportInput, handleExportPlaintext, handleImportPlaintextFile, importPlaintextFileRef, plaintextImportInput };
}

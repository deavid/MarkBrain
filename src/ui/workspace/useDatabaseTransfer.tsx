import { useCallback, useRef } from 'react';
import {
  exportDatabase,
  serializeDatabase,
  parseDatabaseExport,
  importDatabase,
} from '../../services/persistenceService';
import { logger } from '../../utils/logger';

export function useDatabaseTransfer() {

  const importDbFileRef = useRef<HTMLInputElement | null>(null);

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

  return { importDbFileRef, handleExportDatabase, handleImportDatabaseFile, dbImportInput };
}

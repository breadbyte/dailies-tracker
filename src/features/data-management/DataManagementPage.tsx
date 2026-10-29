import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  BACKUP_CATEGORIES,
  type BackupCategory,
  type BackupFile,
  type ImportMode,
  type ImportPreview,
} from '../../domain/backup/types.ts';
import {
  createBackupFile,
  downloadBackup,
} from '../../services/import-export/exportBackup.ts';
import {
  applyBackupImport,
  previewBackupImport,
  readBackupFile,
} from '../../services/import-export/importBackup.ts';
import { clearAllLocalData } from '../../services/import-export/clearData.ts';

const CATEGORY_LABELS: Record<BackupCategory, string> = {
  preferences: 'Preferences',
  selectedGames: 'Selected games and regions',
  customGames: 'Custom games',
  gameSchedules: 'Custom schedules',
  loginCompletionHistory: 'Login completion history',
};

type Busy = 'export' | 'preview' | 'import' | 'clear' | null;

interface Message {
  kind: 'status' | 'alert';
  text: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SummaryTable({
  preview,
  caption,
}: {
  preview: ImportPreview;
  caption: string;
}) {
  return (
    <table className="preview-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">In file</th>
          <th scope="col">Added</th>
          <th scope="col">Updated</th>
          <th scope="col">Skipped</th>
          <th scope="col">Removed</th>
        </tr>
      </thead>
      <tbody>
        {preview.categories.map((category) => {
          const counts = preview.counts[category];
          return (
            <tr key={category}>
              <th scope="row">{CATEGORY_LABELS[category]}</th>
              <td>{counts.incoming}</td>
              <td>{counts.added}</td>
              <td>{counts.updated}</td>
              <td>{counts.skipped}</td>
              <td>{counts.removed}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function DataManagementPage() {
  const [selectedFile, setSelectedFile] = useState<BackupFile | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [categories, setCategories] = useState<BackupCategory[]>([
    ...BACKUP_CATEGORIES,
  ]);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedFile === null) {
      setPreview(null);
      return;
    }

    let active = true;
    setBusy('preview');
    previewBackupImport(selectedFile, { mode, categories })
      .then((next) => {
        if (active) setPreview(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPreview(null);
        setMessage({
          kind: 'alert',
          text: errorMessage(error, 'The backup preview could not be built.'),
        });
      })
      .finally(() => {
        if (active) setBusy(null);
      });

    return () => {
      active = false;
    };
  }, [selectedFile, mode, categories]);

  async function exportData(): Promise<void> {
    setBusy('export');
    setMessage(null);
    try {
      const backup = await createBackupFile();
      downloadBackup(backup);
      setMessage({
        kind: 'status',
        text: 'Backup downloaded. The file stays on this device until you move it.',
      });
    } catch (error) {
      setMessage({
        kind: 'alert',
        text: errorMessage(error, 'The backup could not be exported.'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setConfirmReplace(false);
    setMessage(null);
    if (file === undefined) return;

    setBusy('preview');
    try {
      setSelectedFile(await readBackupFile(file));
    } catch (error) {
      setMessage({
        kind: 'alert',
        text: errorMessage(error, 'The selected file could not be read.'),
      });
    } finally {
      setBusy(null);
    }
  }

  function changeMode(next: ImportMode): void {
    setMode(next);
    if (next !== 'replace') setConfirmReplace(false);
  }

  function toggleCategory(category: BackupCategory, checked: boolean): void {
    setCategories((current) =>
      checked
        ? BACKUP_CATEGORIES.filter(
            (entry) => entry === category || current.includes(entry),
          )
        : current.filter((entry) => entry !== category),
    );
  }

  async function importData(): Promise<void> {
    if (selectedFile === null || preview === null) return;
    if (mode === 'replace' && !confirmReplace) return;

    setBusy('import');
    setMessage(null);
    try {
      let savedBefore = false;
      if (mode === 'replace') {
        const current = await createBackupFile();
        downloadBackup(
          current,
          `dailies-backup-before-import-${current.exportedAt.slice(0, 10)}.json`,
        );
        savedBefore = true;
      }

      const applied = await applyBackupImport(selectedFile, {
        mode,
        categories,
      });
      setResult(applied);
      setMessage({
        kind: 'status',
        text: savedBefore
          ? 'Import complete. A backup of the previous data was downloaded first.'
          : 'Import complete.',
      });
      setSelectedFile(null);
      setPreview(null);
      setConfirmReplace(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    } catch (error) {
      setMessage({
        kind: 'alert',
        text: errorMessage(
          error,
          'The backup could not be imported. Local data was not changed.',
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearData(): Promise<void> {
    if (!confirmClear) return;

    setBusy('clear');
    setMessage(null);
    try {
      await clearAllLocalData();
      setSelectedFile(null);
      setPreview(null);
      setResult(null);
      setConfirmClear(false);
      setConfirmReplace(false);
      if (fileInput.current !== null) fileInput.current.value = '';
      setMessage({ kind: 'status', text: 'All local data was deleted.' });
    } catch (error) {
      setMessage({
        kind: 'alert',
        text: errorMessage(error, 'Local data could not be cleared.'),
      });
    } finally {
      setBusy(null);
    }
  }

  const importDisabled =
    busy !== null ||
    selectedFile === null ||
    preview === null ||
    categories.length === 0 ||
    (mode === 'replace' && !confirmReplace);

  return (
    <section aria-labelledby="data-heading">
      <h1 id="data-heading">Data management</h1>
      <p>
        Backups are local JSON files that you download and keep. They never
        leave this device and do not contain passwords, authentication tokens,
        push subscriptions, or other credentials.
      </p>

      {message !== null ? (
        <p role={message.kind}>{message.text}</p>
      ) : null}

      <section aria-labelledby="export-heading">
        <h2 id="export-heading">Export</h2>
        <p>
          Export includes preferences, selected games and regions, custom
          games, custom schedules, and login completion history.
        </p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => {
            void exportData();
          }}
        >
          Export data
        </button>
      </section>

      <section aria-labelledby="import-heading">
        <h2 id="import-heading">Import</h2>
        <p>
          Choose a Dailies JSON backup. Every record is validated before any
          local data changes, and the import is applied in one transaction.
        </p>
        <p>
          <label htmlFor="backup-file">Backup file</label>
        </p>
        <input
          ref={fileInput}
          id="backup-file"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void chooseFile(event);
          }}
        />
      </section>

      {selectedFile !== null ? (
        <section aria-labelledby="preview-heading">
          <h2 id="preview-heading">Import preview</h2>
          <p className="reset-meta">
            Exported{' '}
            <time dateTime={selectedFile.exportedAt}>
              {new Date(selectedFile.exportedAt).toLocaleString()}
            </time>{' '}
            by app version {selectedFile.appVersion} (backup format{' '}
            {selectedFile.schemaVersion}).
          </p>

          <fieldset>
            <legend>Import mode</legend>
            <label>
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => changeMode('merge')}
              />
              Merge with existing data
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === 'replace'}
                onChange={() => changeMode('replace')}
              />
              Replace selected categories
            </label>
          </fieldset>
          <p className="reset-meta">
            Merge adds new records, updates records whose imported copy is
            newer, and keeps existing preferences. Replace clears only the
            categories you select.
          </p>

          <fieldset>
            <legend>Categories</legend>
            {BACKUP_CATEGORIES.map((category) => (
              <label key={category}>
                <input
                  type="checkbox"
                  checked={categories.includes(category)}
                  onChange={(event) =>
                    toggleCategory(category, event.target.checked)
                  }
                />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </fieldset>

          {preview !== null ? (
            <>
              <SummaryTable
                preview={preview}
                caption="Changes this import will make"
              />
              {preview.warnings.length > 0 ? (
                <ul>
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p role="status">
              {busy === 'preview'
                ? 'Checking the backup against local data…'
                : 'Select at least one category to preview the import.'}
            </p>
          )}

          {mode === 'replace' ? (
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmReplace}
                  onChange={(event) =>
                    setConfirmReplace(event.target.checked)
                  }
                />
                I understand that data in the selected categories will be
                replaced.
              </label>
            </p>
          ) : null}

          <button
            type="button"
            disabled={importDisabled}
            onClick={() => {
              void importData();
            }}
          >
            Import backup
          </button>
        </section>
      ) : null}

      {result !== null ? (
        <section aria-labelledby="result-heading">
          <h2 id="result-heading">Last import result</h2>
          <SummaryTable preview={result} caption="Applied import result" />
        </section>
      ) : null}

      <section aria-labelledby="clear-heading">
        <h2 id="clear-heading">Clear local data</h2>
        <p>
          This deletes all selected games, custom games, schedules, login
          history, and preferences from this browser. Download a backup first
          if you may need the data again. This cannot be undone.
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={confirmClear}
              onChange={(event) => setConfirmClear(event.target.checked)}
            />
            I understand that all local data will be deleted.
          </label>
        </p>
        <button
          type="button"
          disabled={busy !== null || !confirmClear}
          onClick={() => {
            void clearData();
          }}
        >
          Delete all local data
        </button>
      </section>
    </section>
  );
}

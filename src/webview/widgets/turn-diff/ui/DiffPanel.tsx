import * as React from 'react';
import { post, subscribeToHost } from '../../../shared/api/vscode';
import type { DiffIncoming, DiffResultMessage } from '../../../shared/types/diff';
import {
  firstChangedLine,
  isTextPatch,
  parsePatch,
  turnDiffRequest,
  type FileDiffInfo,
  type FileDiffStatus,
  type TurnDiffInit,
} from '../../../../shared/turn-diff';

const STATUS_LETTER: Record<FileDiffStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
};

/** Patches of the selected turn with Prev/Next across the loaded turns. */
export function DiffPanel(): React.ReactElement {
  const [init, setInit] = React.useState<TurnDiffInit | null>(null);
  const [result, setResult] = React.useState<DiffResultMessage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [index, setIndex] = React.useState(0);
  const [copied, setCopied] = React.useState<{ file: string; ok: boolean } | null>(null);
  const requestRef = React.useRef(0);
  const copySeq = React.useRef(0);
  const pendingCopy = React.useRef<{ requestId: string; file: string } | null>(null);

  const request = React.useCallback((from: string) => {
    requestRef.current += 1;
    const requestId = String(requestRef.current);
    setLoading(true);
    setError(null);
    setResult(null);
    pendingCopy.current = null;
    setCopied(null);
    // `from` alone is exactly one turn; a `to` bound would include the next.
    post({ ...turnDiffRequest(requestId, from) });
  }, []);

  const copyFile = React.useCallback((file: string, text: string) => {
    copySeq.current += 1;
    const requestId = String(copySeq.current);
    pendingCopy.current = { requestId, file };
    post({ type: 'copy', requestId, text });
  }, []);

  React.useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  React.useEffect(() => {
    const unsubscribe = subscribeToHost<DiffIncoming>((message) => {
      switch (message.type) {
        case 'init': {
          const next = message.init;
          const found = next.turns.findIndex((turn) => turn.id === next.from);
          const active = found >= 0 ? found : Math.max(0, next.turns.length - 1);
          setInit(next);
          setIndex(active);
          request(next.from);
          break;
        }
        case 'diffResult':
          if (message.requestId !== String(requestRef.current)) {
            return;
          }
          setResult(message);
          setLoading(false);
          break;
        case 'diffError':
          if (message.requestId !== String(requestRef.current)) {
            return;
          }
          setError(message.message);
          setLoading(false);
          break;
        case 'copied': {
          const pending = pendingCopy.current;
          if (!pending || pending.requestId !== message.requestId) {
            return;
          }
          pendingCopy.current = null;
          setCopied({ file: pending.file, ok: message.ok });
          break;
        }
        default:
          break;
      }
    });
    post({ type: 'ready' });
    return unsubscribe;
  }, [request]);

  if (!init) {
    return <div className="boot">Loading changes&hellip;</div>;
  }

  const turns = init.turns;
  const current = turns[index];
  const files = result?.files ?? [];
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const turnLabel = turns.length > 0 ? `Turn ${index + 1}/${turns.length}` : 'Turn';

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= turns.length) {
      return;
    }
    setIndex(next);
    request(turns[next].id);
  };

  const retry = () => request(current?.id ?? init.from);

  return (
    <div className="diff-panel">
      <header className="diff-header">
        <div className="diff-heading">
          <h1 title={init.title}>{init.title}</h1>
          <div className="diff-meta">
            <span>{turnLabel}</span>
            {result ? (
              <>
                <span className="diff-sep">·</span>
                <span>
                  {files.length} {files.length === 1 ? 'file' : 'files'}
                </span>
                <span className="diff-add">+{additions}</span>
                <span className="diff-del">−{deletions}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="diff-actions">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => go(-1)}
            title="Previous turn"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={index >= turns.length - 1}
            onClick={() => go(1)}
            title="Next turn"
          >
            Next
          </button>
          <button type="button" disabled={loading} onClick={retry} title="Reload the patches">
            Refresh
          </button>
        </div>
      </header>

      <div className="diff-scroll">
        {error ? (
          <div className="diff-error">
            <p>{error}</p>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="diff-loading">Loading changes&hellip;</div>
        ) : result ? (
          <>
            {result.tooLarge ? (
              <div className="diff-notice">
                This turn is larger than 8 MB, so the patches are not shown. Open a file to see its
                result.
              </div>
            ) : result.truncated ? (
              <div className="diff-notice">Some patches were truncated by the server.</div>
            ) : null}
            {files.length === 0 ? (
              <div className="diff-empty">No file changes in this turn.</div>
            ) : (
              files.map((file, fileIndex) => (
                <DiffFile
                  key={`${result.requestId}:${file.file}`}
                  file={file}
                  defaultOpen={fileIndex === 0}
                  tooLarge={result.tooLarge === true}
                  copyState={
                    copied && copied.file === file.file
                      ? copied.ok
                        ? 'ok'
                        : 'error'
                      : 'idle'
                  }
                  onCopy={copyFile}
                />
              ))
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function DiffFile({
  file,
  defaultOpen,
  tooLarge,
  copyState,
  onCopy,
}: {
  file: FileDiffInfo;
  defaultOpen: boolean;
  tooLarge: boolean;
  copyState: 'idle' | 'ok' | 'error';
  onCopy: (file: string, text: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(defaultOpen);
  const patch = typeof file.patch === 'string' ? file.patch : '';
  const parsed = React.useMemo(() => parsePatch(patch), [patch]);
  const lines = parsed.lines;

  const openFile = () => {
    post({ type: 'openFile', file: file.file, line: firstChangedLine(patch) });
  };

  return (
    <section className="diff-file" data-status={file.status}>
      <div className="diff-file-head">
        <button
          type="button"
          className="diff-file-toggle"
          aria-expanded={open}
          aria-label={open ? 'Collapse file' : 'Expand file'}
          title={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!open)}
        >
          <span className="diff-chevron">{open ? '▾' : '▸'}</span>
        </button>
        <span className={`diff-status ${file.status}`} title={file.status}>
          {STATUS_LETTER[file.status]}
        </span>
        <button
          type="button"
          className="diff-file-path"
          title={`Open ${file.file} in the editor`}
          onClick={openFile}
        >
          {file.file}
        </button>
        <span className="diff-file-stats">
          <span className="diff-add">+{file.additions}</span>
          <span className="diff-del">−{file.deletions}</span>
        </span>
        {file.more ? <span className="diff-badge">more</span> : null}
        {parsed.truncated ? <span className="diff-badge">truncated</span> : null}
        {patch.length > 0 ? (
          <button
            type="button"
            className="diff-copy"
            onClick={() => onCopy(file.file, patch)}
            title="Copy this patch"
          >
            {copyState === 'ok'
              ? 'Copied'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy patch'}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="diff-body">
          {tooLarge && patch.length === 0 ? (
            <div className="diff-note">
              Patch omitted: the turn is larger than 8 MB. Open the file to see the result.
            </div>
          ) : !isTextPatch(patch) ? (
            <div className="diff-note">Binary file. Open it to see the result.</div>
          ) : lines.length === 0 ? (
            <div className="diff-note">No patch content.</div>
          ) : (
            <>
              <div className="diff-lines">
                {lines.map((line, lineIndex) => (
                  <div key={lineIndex} className={`diff-line ${line.kind}`}>
                    {line.text.length > 0 ? line.text : ' '}
                  </div>
                ))}
              </div>
              {parsed.truncated ? (
                <div className="diff-note">
                  Patch truncated: showing the first {lines.length} lines. Open the file to see the
                  rest.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

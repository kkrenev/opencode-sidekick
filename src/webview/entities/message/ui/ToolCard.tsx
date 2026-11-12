import * as React from 'react';
import { exitLabel, formatDuration, toolOutputWindow } from '../../../../shared/tool-card';
import type { OpenDiffTarget, OpenPathTarget, UiAttachment } from '../../../shared/types/ui';
import { Icon } from '../../../shared/ui/Icon';
import { glyphFor } from '../lib/labels';
import { AttachmentView } from './AttachmentView';

const STATUS_LABEL = {
  queued: 'Queued',
  running: 'Running',
  ok: 'Done',
  error: 'Error',
} as const;

export function ToolCard({
  partId,
  name,
  title,
  status,
  input,
  output,
  path,
  line,
  files,
  ms,
  exitCode,
  command,
  edit,
  outputTruncated,
  defaultOpen,
  isOpen,
  outputExpanded,
  onToggle,
  onCopy,
  onOpenPath,
  onOpenDiff,
  onOpenTerminal,
}: {
  partId: string;
  name: string;
  title: string;
  status: 'queued' | 'running' | 'ok' | 'error';
  input: string;
  output: string;
  /** File the tool touched; the title opens it when present. */
  path?: string;
  line?: number;
  /** Files the tool returned, shown even while the card is collapsed. */
  files?: readonly UiAttachment[];
  /** Wall time of the call in milliseconds. */
  ms?: number;
  /** Exit code of a shell tool; anything but zero reads as a failure. */
  exitCode?: number;
  /** Full command of a shell tool. */
  command?: string;
  /** Before/after text of an `edit`; the title opens it as a diff. */
  edit?: { readonly before: string; readonly after: string };
  /** The server cut the output before it reached the panel. */
  outputTruncated?: boolean;
  defaultOpen: boolean;
  isOpen: boolean;
  /** The output window was expanded by the user or by a search jump. */
  outputExpanded: boolean;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onOpenPath: (target: OpenPathTarget) => void;
  onOpenDiff: (target: OpenDiffTarget) => void;
  onOpenTerminal: (path?: string) => void;
}): React.ReactElement {
  const statusIcon =
    status === 'queued' ? (
      <span className="tool-queued" />
    ) : status === 'running' ? (
      <span className="spinner" />
    ) : status === 'ok' ? (
      <Icon name="check" />
    ) : (
      <Icon name="alert" />
    );

  const toggle = () => onToggle(partId, defaultOpen);
  const target: OpenPathTarget | undefined =
    path !== undefined
      ? { path, ...(line !== undefined ? { line } : {}) }
      : undefined;
  const pathLabel = line !== undefined ? `${path}:${line}` : path;
  // An edit opens as a diff; the file itself stays one button away in the body.
  const diff: OpenDiffTarget | undefined =
    edit !== undefined && path !== undefined
      ? { path, before: edit.before, after: edit.after }
      : undefined;
  const titleAction =
    diff !== undefined
      ? () => onOpenDiff(diff)
      : target !== undefined
        ? () => onOpenPath(target)
        : undefined;
  const titleLabel = diff !== undefined ? `Open diff of ${path}` : `Open ${pathLabel}`;

  const duration = formatDuration(ms);
  const exit = exitLabel(exitCode);

  // One flag expands both windows, so a jump to a hit in either one reveals it.
  const collapsedInput = toolOutputWindow(input, false);
  const collapsedOutput = toolOutputWindow(output, false);
  const expandedInput = toolOutputWindow(input, true);
  const expandedOutput = toolOutputWindow(output, true);
  const inputWindow = outputExpanded ? expandedInput : collapsedInput;
  const outputWindow = outputExpanded ? expandedOutput : collapsedOutput;
  // A collapsed window already applies the character cap, so expanding it may
  // add nothing: the toggle only helps when one of the windows really grows.
  const inputGrows = expandedInput.text.length > collapsedInput.text.length;
  const outputGrows = expandedOutput.text.length > collapsedOutput.text.length;
  const canExpand = inputGrows || outputGrows;
  const growing = outputGrows ? collapsedOutput : collapsedInput;
  const capped = hidesText(collapsedOutput)
    ? collapsedOutput
    : hidesText(collapsedInput)
      ? collapsedInput
      : undefined;
  const more = hidesText(outputWindow) ? outputWindow : inputWindow;
  const toggleExpanded = () => onToggle(`${partId}:output-expanded`, false);

  return (
    <div className="tool" data-status={status}>
      <div className="tool-head" onClick={toggle}>
        <button
          className="tool-toggle"
          type="button"
          aria-expanded={isOpen}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          <span className="tool-glyph">
            <Icon name={glyphFor(name)} />
          </span>
          <span className="tool-name" data-search-region={`${partId}:name`}>
            {name}
          </span>
        </button>
        {titleAction !== undefined ? (
          <button
            className="tool-title tool-title-open"
            type="button"
            data-act={diff !== undefined ? 'open-diff' : 'open-path'}
            data-search-region={`${partId}:title`}
            aria-label={titleLabel}
            title={titleLabel}
            onClick={(event) => {
              event.stopPropagation();
              titleAction();
            }}
          >
            {title}
          </button>
        ) : (
          <span className="tool-title" data-search-region={`${partId}:title`}>
            {title}
          </span>
        )}
        {duration.length > 0 || exit.length > 0 ? (
          <span className="tool-meta">
            {duration.length > 0 ? (
              <span className="tool-duration" title={ms !== undefined ? `${ms} ms` : undefined}>
                {duration}
              </span>
            ) : null}
            {exit.length > 0 ? (
              <span className="tool-exit" data-ok={exitCode === 0} title={`Exit code ${exitCode}`}>
                {exit}
              </span>
            ) : null}
          </span>
        ) : null}
        <span
          className="tool-state"
          role="img"
          aria-label={STATUS_LABEL[status]}
          title={STATUS_LABEL[status]}
        >
          {statusIcon}
        </span>
      </div>
      {files !== undefined && files.length > 0 ? (
        <div className="tool-files">
          {files.map((file, index) => (
            <AttachmentView key={`${file.name}:${index}`} attachment={file} onOpenPath={onOpenPath} />
          ))}
        </div>
      ) : null}
      {isOpen ? (
        <div className="tool-body">
          {command !== undefined ? (
            <div className="tool-command">
              <div className="tool-label">Command</div>
              <code>{command}</code>
              <div className="tool-actions">
                <button type="button" data-act="copy-command" onClick={() => onCopy(command)}>
                  Copy command
                </button>
                <button type="button" data-act="open-terminal" onClick={() => onOpenTerminal(path)}>
                  Open terminal
                </button>
              </div>
            </div>
          ) : null}
          {diff !== undefined && target !== undefined ? (
            <div className="tool-actions">
              <button type="button" data-act="open-file" onClick={() => onOpenPath(target)}>
                Open file
              </button>
            </div>
          ) : null}
          {input.length > 0 ? (
            <div>
              <div className="tool-label">Input</div>
              <pre data-search-region={`${partId}:input`}>{inputWindow.text}</pre>
            </div>
          ) : null}
          {output.length > 0 ? (
            <div>
              <div className="tool-label">Output</div>
              <pre data-search-region={`${partId}:output`}>{outputWindow.text}</pre>
              {outputTruncated ? <div className="tool-note">truncated by server</div> : null}
            </div>
          ) : null}
          {canExpand ? (
            <div className="tool-more">
              <button type="button" data-act="toggle-output" onClick={toggleExpanded}>
                {outputExpanded
                  ? 'Show less'
                  : `Show full${growing.hiddenLines > 0 ? ` (${growing.hiddenLines} lines)` : ''}`}
              </button>
              {hidesText(outputExpanded ? more : growing) ? (
                <span className="tool-more-note">
                  {hiddenNote(outputExpanded ? more : growing)}
                </span>
              ) : null}
            </div>
          ) : capped !== undefined ? (
            <div className="tool-more">
              <span className="tool-more-note">{hiddenNote(capped)}</span>
            </div>
          ) : null}
          {input.length === 0 && output.length === 0 ? (
            <div className="tool-label">No details</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function hidesText(window: { readonly hiddenLines: number; readonly hiddenChars: number }): boolean {
  return window.hiddenLines > 0 || window.hiddenChars > 0;
}

/** `N lines · M chars hidden`, or only the characters when a cap split a line. */
function hiddenNote(window: {
  readonly hiddenLines: number;
  readonly hiddenChars: number;
}): string {
  return window.hiddenLines > 0
    ? `${window.hiddenLines} lines · ${window.hiddenChars} chars hidden`
    : `${window.hiddenChars} chars hidden`;
}

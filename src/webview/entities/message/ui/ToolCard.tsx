import * as React from 'react';
import { clip } from '../../../shared/lib/format';
import type { OpenPathTarget, UiAttachment } from '../../../shared/types/ui';
import { Icon } from '../../../shared/ui/Icon';
import { glyphFor } from '../lib/labels';
import { AttachmentView } from './AttachmentView';

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
  defaultOpen,
  isOpen,
  onToggle,
  onOpenPath,
}: {
  partId: string;
  name: string;
  title: string;
  status: 'running' | 'ok' | 'error';
  input: string;
  output: string;
  /** File the tool touched; the title opens it when present. */
  path?: string;
  line?: number;
  /** Files the tool returned, shown even while the card is collapsed. */
  files?: readonly UiAttachment[];
  defaultOpen: boolean;
  isOpen: boolean;
  onToggle: (id: string, fallback: boolean) => void;
  onOpenPath: (target: OpenPathTarget) => void;
}): React.ReactElement {
  const statusIcon =
    status === 'running' ? (
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
        {target !== undefined ? (
          <button
            className="tool-title tool-title-open"
            type="button"
            data-act="open-path"
            data-search-region={`${partId}:title`}
            aria-label={`Open ${pathLabel}`}
            title={`Open ${pathLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPath(target);
            }}
          >
            {title}
          </button>
        ) : (
          <span className="tool-title" data-search-region={`${partId}:title`}>
            {title}
          </span>
        )}
        <span className="tool-state">{statusIcon}</span>
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
          {input.length > 0 ? (
            <div>
              <div className="tool-label">Input</div>
              <pre data-search-region={`${partId}:input`}>{clip(input)}</pre>
            </div>
          ) : null}
          {output.length > 0 ? (
            <div>
              <div className="tool-label">Output</div>
              <pre data-search-region={`${partId}:output`}>{clip(output)}</pre>
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

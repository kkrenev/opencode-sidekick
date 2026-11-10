import * as React from 'react';
import { clip } from '../../../shared/lib/format';
import { Icon } from '../../../shared/ui/Icon';
import { glyphFor } from '../lib/labels';

export function ToolCard({
  partId,
  name,
  title,
  status,
  input,
  output,
  defaultOpen,
  isOpen,
  onToggle,
}: {
  partId: string;
  name: string;
  title: string;
  status: 'running' | 'ok' | 'error';
  input: string;
  output: string;
  defaultOpen: boolean;
  isOpen: boolean;
  onToggle: (id: string, fallback: boolean) => void;
}): React.ReactElement {
  const statusIcon =
    status === 'running' ? (
      <span className="spinner" />
    ) : status === 'ok' ? (
      <Icon name="check" />
    ) : (
      <Icon name="alert" />
    );

  return (
    <div className="tool" data-status={status}>
      <button className="tool-head" type="button" onClick={() => onToggle(partId, defaultOpen)}>
        <span className="tool-glyph">
          <Icon name={glyphFor(name)} />
        </span>
        <span className="tool-name">{name}</span>
        <span className="tool-title">{title}</span>
        <span className="tool-state">{statusIcon}</span>
      </button>
      {isOpen ? (
        <div className="tool-body">
          {input.length > 0 ? (
            <div>
              <div className="tool-label">Input</div>
              <pre>{clip(input)}</pre>
            </div>
          ) : null}
          {output.length > 0 ? (
            <div>
              <div className="tool-label">Output</div>
              <pre>{clip(output)}</pre>
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

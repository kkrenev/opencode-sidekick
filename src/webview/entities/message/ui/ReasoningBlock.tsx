import * as React from 'react';
import { Icon } from '../../../shared/ui/Icon';

export function ReasoningBlock({
  partId,
  text,
  ms,
  defaultOpen,
  isOpen,
  onToggle,
}: {
  partId: string;
  text: string;
  ms: number;
  defaultOpen: boolean;
  isOpen: boolean;
  onToggle: (id: string, fallback: boolean) => void;
}): React.ReactElement {
  const label = ms > 0 ? `Thought · ${(ms / 1000).toFixed(1)}s` : 'Thought';
  return (
    <div className="thought-wrap">
      <button
        className={`thought${isOpen ? ' open' : ''}`}
        type="button"
        onClick={() => onToggle(partId, defaultOpen)}
      >
        <Icon name="chevron" className="chev" />
        <span>{label}</span>
      </button>
      {isOpen ? <div className="thought-body">{text}</div> : null}
    </div>
  );
}

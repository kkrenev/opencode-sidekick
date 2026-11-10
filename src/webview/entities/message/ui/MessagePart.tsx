import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { UiPart } from '../../../shared/types/ui';
import { MarkdownContent } from './MarkdownContent';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolCard } from './ToolCard';

export function MessagePart({
  part,
  partId,
  streaming,
  settings,
  toggleState,
  onToggle,
  onCopy,
  onOpenExternal,
}: {
  part: UiPart;
  partId: string;
  streaming: boolean;
  settings: SidekickSettings;
  toggleState: Record<string, boolean>;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onOpenExternal: (url: string) => void;
}): React.ReactElement | null {
  if (part.kind === 'text') {
    if (streaming) {
      return (
        <div className="prose streaming" style={{ whiteSpace: 'pre-wrap' }}>
          {part.text}
        </div>
      );
    }
    return <MarkdownContent text={part.text} onCopy={onCopy} onOpenExternal={onOpenExternal} />;
  }

  if (part.kind === 'reasoning') {
    if (settings.reasoning === 'hidden') {
      return null;
    }
    const fallback = settings.reasoning === 'expanded';
    return (
      <ReasoningBlock
        partId={partId}
        text={part.text}
        ms={part.ms}
        defaultOpen={fallback}
        isOpen={toggleState[partId] ?? fallback}
        onToggle={onToggle}
      />
    );
  }

  const fallback = !settings.compactTools;
  return (
    <ToolCard
      partId={partId}
      name={part.name}
      title={part.title}
      status={part.status}
      input={part.input}
      output={part.output}
      defaultOpen={fallback}
      isOpen={toggleState[partId] ?? fallback}
      onToggle={onToggle}
    />
  );
}

import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { OpenPathTarget, UiPart } from '../../../shared/types/ui';
import { AttachmentView } from './AttachmentView';
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
  onOpenPath,
}: {
  part: UiPart;
  partId: string;
  streaming: boolean;
  settings: SidekickSettings;
  toggleState: Record<string, boolean>;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onOpenExternal: (url: string) => void;
  onOpenPath: (target: OpenPathTarget) => void;
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

  if (part.kind === 'image' || part.kind === 'file') {
    return <AttachmentView attachment={part} onOpenPath={onOpenPath} />;
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
      path={part.path}
      line={part.line}
      files={part.files}
      defaultOpen={fallback}
      isOpen={toggleState[partId] ?? fallback}
      onToggle={onToggle}
      onOpenPath={onOpenPath}
    />
  );
}

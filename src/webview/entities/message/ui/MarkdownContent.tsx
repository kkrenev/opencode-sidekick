import * as React from 'react';
import { renderMarkdown } from '../../../shared/lib/markdown';

export function MarkdownContent({
  text,
  onCopy,
  onOpenExternal,
}: {
  text: string;
  onCopy: (text: string) => void;
  onOpenExternal: (url: string) => void;
}): React.ReactElement {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-act]');
    if (!action) {
      return;
    }
    if (action.dataset.act === 'copy') {
      event.preventDefault();
      onCopy(action.dataset.text || '');
    }
    if (action.dataset.act === 'external') {
      event.preventDefault();
      onOpenExternal(action.dataset.url || '');
    }
  };

  return (
    <div
      className="prose"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

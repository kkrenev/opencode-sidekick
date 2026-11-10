import * as React from 'react';
import { Icon } from '../../../shared/ui/Icon';

const SUGGESTIONS = [
  'Explain what this codebase does',
  'Find and fix a failing test',
  'Review my uncommitted changes',
  'Write tests for a module',
];

export function ConversationEmpty({
  onSuggestion,
}: {
  onSuggestion: (text: string) => void;
}): React.ReactElement {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Icon name="logo" />
      </div>
      <h2>What should we build?</h2>
      <p>OpenCode is docked next to your code. Pick a starting point or just start typing.</p>
      <div className="suggestions">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            className="suggestion"
            type="button"
            data-act="suggestion"
            data-text={text}
            onClick={() => onSuggestion(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

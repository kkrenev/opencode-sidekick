import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import { clockTime } from '../../../shared/lib/format';
import type { ModelEntry } from '../../../shared/types/domain';
import type { UiMessage } from '../../../shared/types/ui';
import { labelFor } from '../lib/labels';
import { MessagePart } from './MessagePart';

export function Message({
  message,
  models,
  settings,
  busy,
  isLast,
  toggleState,
  onToggle,
  onCopy,
  onOpenExternal,
}: {
  message: UiMessage;
  models: readonly ModelEntry[];
  settings: SidekickSettings;
  busy: boolean;
  isLast: boolean;
  toggleState: Record<string, boolean>;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onOpenExternal: (url: string) => void;
}): React.ReactElement {
  if (message.role === 'user') {
    const text = message.parts.map((part) => ('text' in part ? part.text : '')).join('\n');
    return (
      <div className="msg user">
        <div className="bubble">
          <span>{text}</span>
          {settings.showTimestamps && message.time ? (
            <span className="bubble-time">{clockTime(message.time)}</span>
          ) : null}
        </div>
      </div>
    );
  }

  const streaming = busy && isLast;

  return (
    <div className="msg assistant" data-msg={message.id}>
      <div className="meta">
        <span className="dot" />
        <span className="meta-label">{labelFor(message, models)}</span>
        {settings.showTimestamps && message.time ? (
          <span className="meta-time">{clockTime(message.time)}</span>
        ) : null}
      </div>
      <div className="body">
        {message.parts.map((part, index) => {
          const partId = `${message.id}:${index}`;
          return (
            <MessagePart
              key={partId}
              part={part}
              partId={partId}
              streaming={streaming && index === message.parts.length - 1}
              settings={settings}
              toggleState={toggleState}
              onToggle={onToggle}
              onCopy={onCopy}
              onOpenExternal={onOpenExternal}
            />
          );
        })}
      </div>
    </div>
  );
}

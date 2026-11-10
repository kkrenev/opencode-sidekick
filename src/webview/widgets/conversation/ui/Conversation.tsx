import * as React from 'react';
import { Message } from '../../../entities/message/ui/Message';
import type { SidekickSettings } from '../../../shared/config/settings';
import type { ModelEntry } from '../../../shared/types/domain';
import type { UiMessage } from '../../../shared/types/ui';
import { ConversationEmpty } from './ConversationEmpty';
import { ConversationOffline } from './ConversationOffline';

export function Conversation({
  connected,
  error,
  sessionId,
  messages,
  models,
  settings,
  busy,
  toggleState,
  onToggle,
  onCopy,
  onOpenExternal,
  onSuggestion,
  onRetry,
}: {
  connected: boolean;
  error: string | null;
  sessionId: string | undefined;
  messages: readonly UiMessage[];
  models: readonly ModelEntry[];
  settings: SidekickSettings;
  busy: boolean;
  toggleState: Record<string, boolean>;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onOpenExternal: (url: string) => void;
  onSuggestion: (text: string) => void;
  onRetry: () => void;
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottom = React.useRef(true);

  React.useEffect(() => {
    stickToBottom.current = true;
  }, [sessionId]);

  React.useLayoutEffect(() => {
    if (!settings.autoScroll || !stickToBottom.current) {
      return;
    }
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, busy, settings.autoScroll]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 90;
  };

  return (
    <div className="scroll" id="scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="thread" id="thread">
        {!connected ? (
          <ConversationOffline error={error} onRetry={onRetry} />
        ) : messages.length === 0 ? (
          <ConversationEmpty onSuggestion={onSuggestion} />
        ) : (
          <>
            {messages.map((message, index) => (
              <Message
                key={message.id}
                message={message}
                models={models}
                settings={settings}
                busy={busy}
                isLast={index === messages.length - 1}
                toggleState={toggleState}
                onToggle={onToggle}
                onCopy={onCopy}
                onOpenExternal={onOpenExternal}
              />
            ))}
            {busy ? (
              <div className="working">
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

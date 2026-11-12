import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import { clockTime } from '../../../shared/lib/format';
import type { ModelEntry } from '../../../shared/types/domain';
import type { OpenPathTarget, UiAttachmentPart, UiMessage } from '../../../shared/types/ui';
import { messageText } from '../../../../shared/transcript-markdown';
import { labelFor } from '../lib/labels';
import { Icon } from '../../../shared/ui/Icon';
import { AttachmentView } from './AttachmentView';
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
  onCopyMessage,
  onMessageMenu,
  onOpenExternal,
  onOpenPath,
}: {
  message: UiMessage;
  models: readonly ModelEntry[];
  settings: SidekickSettings;
  busy: boolean;
  isLast: boolean;
  toggleState: Record<string, boolean>;
  onToggle: (id: string, fallback: boolean) => void;
  onCopy: (text: string) => void;
  onCopyMessage: (message: UiMessage) => void;
  /** Opens the message menu at the pointer, not at the message box. */
  onMessageMenu: (id: string, point: { x: number; y: number }) => void;
  onOpenExternal: (url: string) => void;
  onOpenPath: (target: OpenPathTarget) => void;
}): React.ReactElement {
  const streaming = message.role === 'assistant' && busy && isLast;
  const hasText = messageText(message).length > 0;

  // A right click inside a text selection keeps the native menu, so copying a
  // phrase out of a message works exactly as before.
  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    event.preventDefault();
    onMessageMenu(message.id, { x: event.clientX, y: event.clientY });
  };

  const copyButton =
    !streaming && hasText ? (
      <button
        className="msg-copy"
        type="button"
        data-act="copy-message"
        aria-label="Copy message"
        title="Copy message"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onCopyMessage(message)}
      >
        <Icon name="copy" />
      </button>
    ) : null;

  if (message.role === 'user') {
    const text = message.parts.map((part) => ('text' in part ? part.text : '')).join('\n');
    const attachments = message.parts.filter(isAttachment);
    return (
      <div className="msg user" data-msg={message.id} onContextMenu={onContextMenu}>
        {text.trim().length > 0 ? (
          <div className="bubble">
            <span>{text}</span>
            {settings.showTimestamps && message.time ? (
              <span className="bubble-time">{clockTime(message.time)}</span>
            ) : null}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="msg-attachments">
            {attachments.map((part, index) => (
              <AttachmentView
                key={`${message.id}:attachment:${index}`}
                attachment={part}
                onOpenPath={onOpenPath}
              />
            ))}
          </div>
        ) : null}
        {copyButton}
      </div>
    );
  }

  return (
    <div
      className={`msg assistant${copyButton ? ' has-copy' : ''}`}
      data-msg={message.id}
      onContextMenu={onContextMenu}
    >
      {copyButton}
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
              onOpenPath={onOpenPath}
            />
          );
        })}
      </div>
    </div>
  );
}

function isAttachment(part: { readonly kind: string }): part is UiAttachmentPart {
  return part.kind === 'image' || part.kind === 'file';
}

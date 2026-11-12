import * as React from 'react';
import { AttachmentTray } from '../../../features/attach-menu/ui/AttachmentTray';
import { MAX_ATTACHMENT_BYTES } from '../../../features/attach-menu/lib/attachments';
import type { SidekickSettings } from '../../../shared/config/settings';
import { sendHint } from '../../../shared/lib/format';
import type { PendingAttachment } from '../../../shared/types/domain';
import type { SessionUsage } from '../../../shared/types/snapshot';
import { Icon } from '../../../shared/ui/Icon';
import { PASTE_ATTACH_THRESHOLD } from '../lib/paste';
import { ContextMeter } from './ContextMeter';

export function Composer({
  draft,
  busy,
  sendBlocked,
  settings,
  sessionId,
  caret,
  selectionEnd,
  attachments,
  usage,
  attachMenuOpen,
  atLimit,
  inputRef,
  composerRef,
  modelLabel,
  effortLabel,
  modeLabel,
  modelIsDefault,
  effortIsDefault,
  modeIsDefault,
  queueCount,
  queuePending,
  onDraftChange,
  onKeyDown,
  onCaretChange,
  onPasteFiles,
  onDropFiles,
  onDropRejected,
  onAttachMenu,
  onAttachText,
  onRemoveAttachment,
  onSend,
  onStop,
  onPickModel,
  onPickEffort,
  onPickMode,
  onCompact,
  paletteOpen,
}: {
  draft: string;
  busy: boolean;
  /** Reason sending is disabled right now, shown as the button tooltip. */
  sendBlocked?: string;
  settings: SidekickSettings;
  sessionId: string | undefined;
  caret: number;
  selectionEnd: number;
  attachments: readonly PendingAttachment[];
  usage: SessionUsage;
  attachMenuOpen: boolean;
  atLimit: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  composerRef: React.RefObject<HTMLDivElement | null>;
  modelLabel: string;
  effortLabel: string;
  modeLabel: string;
  modelIsDefault: boolean;
  effortIsDefault: boolean;
  modeIsDefault: boolean;
  /** Rows the server still has in the inbox; the chip is hidden at zero. */
  queueCount: number;
  /** Inbox ids with an action in flight; the chip reports the update. */
  queuePending: readonly string[];
  onDraftChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCaretChange: () => void;
  onPasteFiles: (files: readonly File[]) => void;
  onDropFiles: (files: readonly File[]) => void;
  onDropRejected: (message: string) => void;
  onAttachMenu: (anchor: HTMLElement) => void;
  /** Attach a large pasted text as a file; resolves with the accepted count. */
  onAttachText: (text: string) => Promise<number>;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPickModel: (anchor: HTMLElement) => void;
  onPickEffort: (anchor: HTMLElement) => void;
  onPickMode: (anchor: HTMLElement) => void;
  onCompact: () => void;
  /** The `/` and `@` palettes own Enter while they are open. */
  paletteOpen: boolean;
}): React.ReactElement {
  const [focused, setFocused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [pasted, setPasted] = React.useState<{ text: string; start: number } | null>(null);
  const [attaching, setAttaching] = React.useState(false);
  const dragDepth = React.useRef(0);
  const caretRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setPasted(null);
  }, [sessionId]);

  // A send or a suggestion replaces the draft, so a banner whose fragment is
  // gone (or a draft that went empty) must not offer to attach it again.
  React.useEffect(() => {
    setPasted((current) => {
      if (!current) {
        return current;
      }
      if (draft.length === 0) {
        return null;
      }
      return draft.slice(current.start, current.start + current.text.length) === current.text
        ? current
        : null;
    });
  }, [draft]);

  const sendsOnKey = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) {
      return false;
    }
    return settings.sendKey === 'enter' || event.metaKey || event.ctrlKey;
  };

  // The text stays in the draft, so the caret has to follow the cut range once
  // React has written the shorter value back into the textarea.
  React.useLayoutEffect(() => {
    const element = inputRef.current;
    const caret = caretRef.current;
    if (!element || caret === null) {
      return;
    }
    caretRef.current = null;
    const at = Math.min(caret, element.value.length);
    element.setSelectionRange(at, at);
  }, [draft, inputRef]);

  const attachPasted = async () => {
    const pending = pasted;
    if (!pending || attaching) {
      return;
    }
    setAttaching(true);
    // Only cut the draft once the host confirms the attachment: a full tray or
    // a failed read must leave the text exactly where it was.
    let attached = 0;
    try {
      attached = await onAttachText(pending.text);
    } catch {
      attached = 0;
    } finally {
      setAttaching(false);
    }
    inputRef.current?.focus();
    if (attached <= 0) {
      return;
    }
    setPasted(null);
    const element = inputRef.current;
    const current = element ? element.value : draft;
    const start = Math.max(0, Math.min(pending.start, current.length));
    if (current.slice(start, start + pending.text.length) === pending.text) {
      caretRef.current = start;
      onDraftChange(
        `${current.slice(0, start)}${current.slice(start + pending.text.length)}`,
      );
    }
  };

  React.useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft, inputRef]);

  React.useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element || !sessionId) {
      return;
    }
    const start = Math.min(Math.max(caret, 0), element.value.length);
    const end = Math.min(Math.max(selectionEnd, start), element.value.length);
    element.setSelectionRange(start, end);
  }, [sessionId]);

  const hasText = draft.trim().length > 0 || attachments.length > 0;
  const dragFiles = (event: React.DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div className="composer-wrap">
      <div
        className={`composer${focused ? ' focused' : ''}${dragging ? ' dragging' : ''}`}
        ref={composerRef}
        id="composer"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pasted) {
            setPasted(null);
          }
        }}
        onDragEnter={(event) => {
          if (!dragFiles(event)) {
            return;
          }
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!dragFiles(event)) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!dragFiles(event)) {
            return;
          }
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          if (!dragFiles(event)) {
            return;
          }
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const items = Array.from(event.dataTransfer.items ?? []);
          if (items.length === 0) {
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) {
              onDropFiles(files);
            }
            return;
          }
          const entries = items.map((item) => item.webkitGetAsEntry?.() ?? null);
          const hasDirectory = entries.some((entry) => entry?.isDirectory === true);
          const files = items
            .map((_item, index) =>
              entries[index]?.isDirectory ? undefined : event.dataTransfer.files[index],
            )
            .filter((file): file is File => file instanceof File);
          if (hasDirectory) {
            onDropRejected('Drop files only. Use + → Folder to attach a folder.');
          }
          if (files.length > 0) {
            onDropFiles(files);
          }
        }}
      >
        {pasted ? (
          <div className="composer-banner" role="status">
            <span className="composer-banner-text">
              Pasted {pasted.text.length.toLocaleString()} characters — attach as a file instead?
            </span>
            <span className="composer-banner-actions">
              <button
                className="banner-btn"
                type="button"
                disabled={attaching}
                onClick={attachPasted}
              >
                Attach as file
              </button>
              <button
                className="banner-btn"
                type="button"
                disabled={attaching}
                onClick={() => {
                  setPasted(null);
                  inputRef.current?.focus();
                }}
              >
                Keep in message
              </button>
            </span>
          </div>
        ) : null}
        <textarea
          id="input"
          ref={inputRef}
          rows={1}
          placeholder="Ask OpenCode anything about this workspace"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (pasted && !paletteOpen && sendsOnKey(event)) {
              setPasted(null);
            }
            onKeyDown(event);
          }}
          onKeyUp={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
              onCaretChange();
            }
          }}
          onClick={onCaretChange}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length > 0) {
              event.preventDefault();
              onPasteFiles(files);
              return;
            }
            // The paste itself stays native: the banner is only an offer, so
            // Cmd/Ctrl+V, Shift+Insert and undo keep working.
            const text = event.clipboardData?.getData('text/plain') ?? '';
            if (
              text.length > PASTE_ATTACH_THRESHOLD &&
              // Never offer a file the attachment tray would refuse.
              new Blob([text]).size <= MAX_ATTACHMENT_BYTES
            ) {
              setPasted({ text, start: event.currentTarget.selectionStart ?? 0 });
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <AttachmentTray attachments={attachments} onRemove={onRemoveAttachment} />
        <div className="composer-foot">
          <button
            className="chip attach-btn"
            type="button"
            data-act="attach-menu"
            aria-label="Attach files"
            aria-expanded={attachMenuOpen}
            title={
              atLimit ? 'Attachment limit reached' : 'Attach files (Cmd/Ctrl+Shift+A)'
            }
            disabled={atLimit}
            onClick={(event) => onAttachMenu(event.currentTarget)}
          >
            <Icon name="plus" />
          </button>
          <button
            className={`chip${modelIsDefault ? ' is-default' : ''}`}
            type="button"
            data-act="model"
            title={modelIsDefault ? 'Default model' : 'Model'}
            onClick={(event) => onPickModel(event.currentTarget)}
          >
            <Icon name="model" />
            <span className="chip-text" id="model-chip">
              {modelLabel}
            </span>
          </button>
          <button
            className={`chip${effortIsDefault ? ' is-default' : ''}`}
            type="button"
            data-act="effort"
            title={effortIsDefault ? 'Default reasoning effort' : 'Reasoning effort'}
            onClick={(event) => onPickEffort(event.currentTarget)}
          >
            <Icon name="effort" />
            <span className="chip-text" id="effort-chip">
              {effortLabel}
            </span>
          </button>
          <button
            className={`chip${modeIsDefault ? ' is-default' : ''}`}
            type="button"
            data-act="mode"
            title={modeIsDefault ? 'Default agent mode' : 'Agent mode'}
            onClick={(event) => onPickMode(event.currentTarget)}
          >
            <Icon name="agent" />
            <span className="chip-text" id="mode-chip">
              {modeLabel}
            </span>
          </button>
          <ContextMeter usage={usage} busy={busy} blocked={sendBlocked} onCompact={onCompact} />
          {queueCount > 0 ? (
            <span
              className="chip queue-chip"
              data-act="queue"
              title={
                queuePending.length > 0
                  ? 'Updating queued messages…'
                  : 'Messages waiting for the current turn'
              }
              aria-busy={queuePending.length > 0}
            >
              <span className="chip-text">{queueCount} in queue</span>
            </span>
          ) : null}
          <span className="grow" />
          <span className="keyhint">/ commands · @ files &amp; skills</span>
          {busy ? (
            <button
              className="send stop"
              id="send"
              type="button"
              data-act="stop"
              title="Stop"
              onClick={onStop}
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button
              className="send"
              id="send"
              type="button"
              data-act="send"
              title={sendBlocked ?? 'Send'}
              disabled={!hasText || sendBlocked !== undefined}
              onClick={() => {
                setPasted(null);
                onSend();
              }}
            >
              <Icon name="send" />
            </button>
          )}
          {busy && hasText ? (
            // The running turn keeps its Stop button; this one adds the draft
            // to the queue (or steers it), so a mouse user can do what Enter does.
            <button
              className="send queue-send"
              id="send-queue"
              type="button"
              data-act="send"
              title={
                sendBlocked ??
                (settings.queueDelivery === 'steer' ? 'Send now (steer)' : 'Add to queue')
              }
              disabled={sendBlocked !== undefined}
              onClick={() => {
                setPasted(null);
                onSend();
              }}
            >
              <Icon name="send" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="hint">
        <span>{sendHint(settings.sendKey)}</span>
        <span id="status" className={busy ? 'working-status' : ''}>
          {busy ? 'Working' : ''}
        </span>
      </div>
    </div>
  );
}

import * as React from 'react';
import type { SidekickSettings } from '../../../shared/config/settings';
import { sendHint } from '../../../shared/lib/format';
import { Icon } from '../../../shared/ui/Icon';

export function Composer({
  draft,
  busy,
  settings,
  inputRef,
  composerRef,
  modelLabel,
  effortLabel,
  modeLabel,
  modelIsDefault,
  effortIsDefault,
  modeIsDefault,
  onDraftChange,
  onKeyDown,
  onCaretChange,
  onSend,
  onStop,
  onPickModel,
  onPickEffort,
  onPickMode,
}: {
  draft: string;
  busy: boolean;
  settings: SidekickSettings;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  composerRef: React.RefObject<HTMLDivElement | null>;
  modelLabel: string;
  effortLabel: string;
  modeLabel: string;
  modelIsDefault: boolean;
  effortIsDefault: boolean;
  modeIsDefault: boolean;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCaretChange: () => void;
  onSend: () => void;
  onStop: () => void;
  onPickModel: (anchor: HTMLElement) => void;
  onPickEffort: (anchor: HTMLElement) => void;
  onPickMode: (anchor: HTMLElement) => void;
}): React.ReactElement {
  const [focused, setFocused] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft, inputRef]);

  const hasText = draft.trim().length > 0;

  return (
    <div className="composer-wrap">
      <div className={`composer${focused ? ' focused' : ''}`} ref={composerRef} id="composer">
        <textarea
          id="input"
          ref={inputRef}
          rows={1}
          placeholder="Ask OpenCode anything about this workspace"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
              onCaretChange();
            }
          }}
          onClick={onCaretChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <div className="composer-foot">
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
          <span className="grow" />
          <span className="keyhint">/ commands · @ files &amp; skills</span>
          <button
            className={`send${busy ? ' stop' : ''}`}
            id="send"
            type="button"
            data-act={busy ? 'stop' : 'send'}
            title={busy ? 'Stop' : 'Send'}
            disabled={!busy && !hasText}
            onClick={busy ? onStop : onSend}
          >
            <Icon name={busy ? 'stop' : 'send'} />
          </button>
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

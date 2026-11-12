import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/webview/shared/config/settings';
import type { SidekickSettings } from '../../../src/webview/shared/config/settings';
import type { PendingAttachment } from '../../../src/webview/shared/types/domain';
import type { SessionUsage } from '../../../src/webview/shared/types/snapshot';
import { Composer } from '../../../src/webview/widgets/composer/ui/Composer';

const USAGE: SessionUsage = { used: null, level: 'unknown', compacting: false, compacted: false };

const ATTACHMENT: PendingAttachment = {
  id: 'a1',
  name: 'a.ts',
  uri: 'file:///repo/a.ts',
  kind: 'file',
  size: 2048,
};

function props(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return {
    draft: '',
    busy: false,
    settings: DEFAULT_SETTINGS as SidekickSettings,
    sessionId: undefined,
    caret: 0,
    selectionEnd: 0,
    attachments: [],
    usage: USAGE,
    attachMenuOpen: false,
    atLimit: false,
    inputRef: React.createRef<HTMLTextAreaElement>(),
    composerRef: React.createRef<HTMLDivElement>(),
    modelLabel: 'gpt-5.1',
    effortLabel: 'High',
    modeLabel: 'Build',
    modelIsDefault: false,
    effortIsDefault: false,
    modeIsDefault: false,
    queueCount: 0,
    queuePending: [],
    onDraftChange: vi.fn(),
    onKeyDown: vi.fn(),
    onCaretChange: vi.fn(),
    onPasteFiles: vi.fn(),
    onDropFiles: vi.fn(),
    onDropRejected: vi.fn(),
    onAttachMenu: vi.fn(),
    onAttachText: vi.fn(async () => 0),
    onRemoveAttachment: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onPickModel: vi.fn(),
    onPickEffort: vi.fn(),
    onPickMode: vi.fn(),
    onCompact: vi.fn(),
    paletteOpen: false,
    ...overrides,
  };
}

describe('Composer', () => {
  it('renders the draft and reports every change', () => {
    const onDraftChange = vi.fn();
    render(<Composer {...props({ draft: 'hello', onDraftChange })} />);

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('hello');

    fireEvent.change(input, { target: { value: 'hello!' } });
    expect(onDraftChange).toHaveBeenCalledWith('hello!');
  });

  it('keeps Send disabled while there is nothing to send', () => {
    const { rerender } = render(<Composer {...props()} />);
    expect(screen.getByTitle('Send')).toBeDisabled();

    rerender(<Composer {...props({ draft: 'hi' })} />);
    expect(screen.getByTitle('Send')).toBeEnabled();
  });

  it('counts an attachment as content, so an empty draft can still send', () => {
    render(<Composer {...props({ attachments: [ATTACHMENT] })} />);

    expect(screen.getByTitle('Send')).toBeEnabled();
  });

  it('explains why Send is blocked and keeps it disabled', () => {
    render(<Composer {...props({ draft: 'hi', sendBlocked: 'Finish the revert first' })} />);

    const send = screen.getByTitle('Finish the revert first');
    expect(send).toBeDisabled();
  });

  it('sends on a click', () => {
    const onSend = vi.fn();
    render(<Composer {...props({ draft: 'hi', onSend })} />);

    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('turns Send into Stop while the agent works and offers the queue', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Composer {...props({ draft: 'next', busy: true, onSend, onStop })} />);

    fireEvent.click(screen.getByTitle('Stop'));
    expect(onStop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Add to queue'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('removes an attachment from its chip', () => {
    const onRemoveAttachment = vi.fn();
    render(
      <Composer
        {...props({ attachments: [ATTACHMENT], onRemoveAttachment })}
      />,
    );

    fireEvent.click(screen.getByLabelText('Remove a.ts'));

    expect(onRemoveAttachment).toHaveBeenCalledWith('a1');
  });

  it('describes the configured send key in the hint', () => {
    const { rerender } = render(<Composer {...props()} />);
    expect(screen.getByText('Enter send · Shift+Enter new line')).toBeInTheDocument();

    rerender(
      <Composer {...props({ settings: { ...DEFAULT_SETTINGS, sendKey: 'mod-enter' } })} />,
    );
    expect(screen.getByText('Cmd/Ctrl+Enter send · Enter new line')).toBeInTheDocument();
  });
});

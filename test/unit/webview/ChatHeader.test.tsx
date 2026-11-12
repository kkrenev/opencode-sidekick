import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionTab } from '../../../src/webview/shared/types/domain';
import { ChatHeader } from '../../../src/webview/widgets/chat-header/ui/ChatHeader';

function tab(overrides: Partial<SessionTab> & { id: string }): SessionTab {
  return {
    title: overrides.id,
    running: false,
    missing: false,
    unread: false,
    stale: false,
    pinned: false,
    permissions: 0,
    ...overrides,
  };
}

const TABS = [tab({ id: 'a', title: 'Chat one' }), tab({ id: 'b', title: 'Chat two' })];

function props(overrides: Partial<React.ComponentProps<typeof ChatHeader>> = {}) {
  return {
    tabs: TABS,
    activeId: 'a',
    connected: true,
    folders: [],
    activeDirectory: '/repo',
    renaming: null,
    onSelectFolder: vi.fn(),
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onContextMenu: vi.fn(),
    onNew: vi.fn(),
    onHistory: vi.fn(),
    onSettings: vi.fn(),
    onMenu: vi.fn(),
    onRenameDraft: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    ...overrides,
  };
}

describe('ChatHeader', () => {
  it('marks only the active tab as selected', () => {
    render(<ChatHeader {...props()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('activates a tab on click', () => {
    const onActivate = vi.fn();
    render(<ChatHeader {...props({ onActivate })} />);

    fireEvent.click(screen.getByText('Chat two'));

    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('closes a tab from its close button without activating it', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(<ChatHeader {...props({ onActivate, onClose })} />);

    fireEvent.click(screen.getByLabelText('Close Chat two'));

    expect(onClose).toHaveBeenCalledWith('b');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('hides the close button of a pinned tab', () => {
    render(<ChatHeader {...props({ tabs: [tab({ id: 'a', title: 'Chat one', pinned: true })] })} />);

    expect(screen.queryByLabelText('Close Chat one')).toBeNull();
  });

  it('opens the tab menu from the context menu of that tab', () => {
    const onContextMenu = vi.fn();
    render(<ChatHeader {...props({ onContextMenu })} />);

    const second = screen.getAllByRole('tab')[1];
    fireEvent.contextMenu(second);

    expect(onContextMenu).toHaveBeenCalledWith('b', second);
  });

  it('renames a tab in place and commits on Enter', () => {
    const onRenameDraft = vi.fn();
    const onRenameCommit = vi.fn();
    render(
      <ChatHeader
        {...props({ renaming: { id: 'a', draft: 'Chat one' }, onRenameDraft, onRenameCommit })}
      />,
    );

    const input = screen.getByLabelText('Session title');
    expect(input).toHaveValue('Chat one');

    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect(onRenameDraft).toHaveBeenCalledWith('Renamed');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameCommit).toHaveBeenCalledTimes(1);
  });

  it('commits a rename on blur but cancels it on Escape', () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const { rerender } = render(
      <ChatHeader
        {...props({ renaming: { id: 'a', draft: 'Chat one' }, onRenameCommit, onRenameCancel })}
      />,
    );

    fireEvent.blur(screen.getByLabelText('Session title'));
    expect(onRenameCommit).toHaveBeenCalledTimes(1);

    onRenameCommit.mockClear();
    rerender(
      <ChatHeader
        {...props({ renaming: { id: 'a', draft: 'Chat one' }, onRenameCommit, onRenameCancel })}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('Session title'), { key: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it('runs the header actions', () => {
    const onNew = vi.fn();
    const onHistory = vi.fn();
    const onSettings = vi.fn();
    const onMenu = vi.fn();
    render(<ChatHeader {...props({ onNew, onHistory, onSettings, onMenu })} />);

    fireEvent.click(screen.getByTitle('New session'));
    fireEvent.click(screen.getByTitle('Session history'));
    fireEvent.click(screen.getByTitle('Settings'));
    const more = screen.getByTitle('More');
    fireEvent.click(more);

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onHistory).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledWith(more);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabMenu } from '../../../src/webview/features/tab-menu/ui/TabMenu';

let anchor: HTMLButtonElement | undefined;

afterEach(() => {
  anchor?.remove();
  anchor = undefined;
});

function menuProps(overrides: Partial<React.ComponentProps<typeof TabMenu>> = {}) {
  anchor ??= document.body.appendChild(document.createElement('button'));
  return {
    anchor,
    title: 'Chat one',
    pinned: false,
    available: true,
    onClose: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onArchive: vi.fn(),
    onFork: vi.fn(),
    onOpenInEditor: vi.fn(),
    onCopyId: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe('TabMenu', () => {
  it('asks a second time before deleting a session', () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(<TabMenu {...menuProps({ onDelete, onClose })} />);

    fireEvent.click(screen.getByText('Delete session'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Confirm delete' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('cancels the delete confirmation and keeps the menu open', () => {
    const onDelete = vi.fn();
    render(<TabMenu {...menuProps({ onDelete })} />);

    fireEvent.click(screen.getByText('Delete session'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByRole('group', { name: 'Confirm delete' })).toBeNull();
    expect(screen.getByText('Delete session')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('pins, renames and closes the menu', () => {
    const onTogglePin = vi.fn();
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(<TabMenu {...menuProps({ onTogglePin, onRename, onClose })} />);

    fireEvent.click(screen.getByText('Pin tab'));
    fireEvent.click(screen.getByText('Rename'));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('offers Unpin for a pinned tab', () => {
    const onTogglePin = vi.fn();
    render(<TabMenu {...menuProps({ pinned: true, onTogglePin })} />);

    fireEvent.click(screen.getByText('Unpin tab'));

    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('disables the session actions of a tab that is gone from the server', () => {
    render(<TabMenu {...menuProps({ available: false })} />);

    expect(screen.getByText('Open in editor tab').closest('button')).toBeDisabled();
    expect(screen.getByText('Rename').closest('button')).toBeDisabled();
    expect(screen.getByText('Archive').closest('button')).toBeDisabled();
    expect(screen.getByText('Fork').closest('button')).toBeDisabled();
    expect(screen.getByText('Delete session').closest('button')).toBeDisabled();
    expect(screen.getByText('Copy session ID').closest('button')).toBeEnabled();
  });
});

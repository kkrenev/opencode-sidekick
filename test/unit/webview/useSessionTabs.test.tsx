import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionTabs } from '../../../src/webview/app/model/useSessionTabs';
import type { SessionTab } from '../../../src/webview/shared/types/domain';
import { host } from './host';

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

function renderTabs(tabs: readonly SessionTab[], activeId: string | null) {
  const showToast = vi.fn();
  const view = renderHook(() => useSessionTabs({ tabs, activeId, showToast }));
  return { ...view, showToast };
}

describe('useSessionTabs', () => {
  it('refuses to close a pinned tab and says why', () => {
    const { result, showToast } = renderTabs([tab({ id: 'a', pinned: true })], 'a');

    act(() => result.current.closeTab('a'));

    expect(showToast).toHaveBeenCalledWith('Pinned — unpin to close');
    expect(host.posted).toEqual([]);
  });

  it('asks the host to close a regular tab', () => {
    const { result } = renderTabs([tab({ id: 'a' })], 'a');

    act(() => result.current.closeTab('a'));

    expect(host.posted).toEqual([{ type: 'closeTab', id: 'a' }]);
  });

  it('copies the session id and confirms it', () => {
    const { result, showToast } = renderTabs([tab({ id: 'a' })], 'a');

    act(() => result.current.copyId('a'));

    expect(host.posted).toEqual([{ type: 'copy', text: 'a' }]);
    expect(showToast).toHaveBeenCalledWith('Session ID copied');
  });

  it('closes the active tab on Ctrl+W', () => {
    const { showToast } = renderTabs([tab({ id: 'a' }), tab({ id: 'b' })], 'b');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    });

    expect(host.posted).toEqual([{ type: 'closeTab', id: 'b' }]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps a pinned active tab on Ctrl+W', () => {
    const { showToast } = renderTabs([tab({ id: 'a', pinned: true })], 'a');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    });

    expect(host.posted).toEqual([]);
    expect(showToast).toHaveBeenCalledWith('Pinned — unpin to close');
  });

  it('activates the numbered tab on Ctrl+2', () => {
    renderTabs([tab({ id: 'a' }), tab({ id: 'b' })], 'a');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }));
    });

    expect(host.posted).toEqual([{ type: 'activateTab', id: 'b' }]);
  });

  it('deletes a session that the menu already confirmed', () => {
    const { result } = renderTabs([tab({ id: 'a' })], 'a');

    act(() => result.current.deleteTab('a'));

    expect(host.posted).toEqual([{ type: 'deleteSession', id: 'a', confirmed: true }]);
  });
});

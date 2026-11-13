import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { folderName } from '../../../src/webview/entities/session/lib/session';
import type { FolderRef, SessionSummary } from '../../../src/webview/shared/types/domain';
import { SessionHistory } from '../../../src/webview/widgets/session-history/ui/SessionHistory';

const NOW = Date.now();

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: overrides.id,
    created: NOW - 3_600_000,
    updated: NOW - 60_000,
    running: false,
    ...overrides,
  };
}

const FOLDERS: FolderRef[] = [
  { directory: '/work/alpha', name: 'alpha' },
  { directory: '/work/beta', name: 'beta' },
];

function props(overrides: Partial<React.ComponentProps<typeof SessionHistory>> = {}) {
  return {
    sessions: [session({ id: 's1', title: 'Login bug', directory: '/work/alpha' })],
    current: null,
    query: '',
    scope: 'folder' as const,
    folders: FOLDERS,
    onQuery: vi.fn(),
    onScope: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('SessionHistory', () => {
  it('renders the title and marks a running session with the live dot', () => {
    const { container } = render(
      <SessionHistory {...props({ sessions: [session({ id: 's1', title: 'Login bug', running: true })] })} />,
    );

    expect(screen.getByText('Login bug')).toBeInTheDocument();
    expect(container.querySelector('.session-row .live')).not.toBeNull();
  });

  it('shows the folder of a row only in the workspace scope', () => {
    const view = render(<SessionHistory {...props()} />);
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();

    view.rerender(<SessionHistory {...props({ scope: 'workspace' })} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('opens a folder row without a directory and a workspace row with its folder', () => {
    const onOpen = vi.fn();
    const view = render(<SessionHistory {...props({ onOpen })} />);

    fireEvent.click(screen.getByText('Login bug'));

    expect(onOpen).toHaveBeenCalledWith('s1', undefined);

    view.rerender(<SessionHistory {...props({ onOpen, scope: 'workspace' })} />);
    fireEvent.click(screen.getByText('Login bug'));

    expect(onOpen).toHaveBeenLastCalledWith('s1', '/work/alpha');
  });

  it('hides the scope switch when there is a single folder', () => {
    render(<SessionHistory {...props({ folders: [FOLDERS[0]] })} />);

    expect(screen.queryByRole('group', { name: 'Session scope' })).not.toBeInTheDocument();
  });

  it('switches the scope from the segment and exposes the pressed state', () => {
    const onScope = vi.fn();
    render(<SessionHistory {...props({ onScope })} />);

    expect(screen.getByRole('button', { name: 'This folder' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'All folders' }));

    expect(onScope).toHaveBeenCalledWith('workspace');
  });

  it('explains an empty list, and a search that found nothing differently', () => {
    const view = render(<SessionHistory {...props({ sessions: [] })} />);
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();

    view.rerender(<SessionHistory {...props({ sessions: [], query: 'zzz' })} />);
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
  });
});

describe('folderName', () => {
  it('maps a directory to its folder name', () => {
    expect(folderName({ directory: '/work/beta' }, FOLDERS)).toBe('beta');
  });

  it('keeps the path for a folder that left the workspace and drops an empty one', () => {
    expect(folderName({ directory: '/work/gone' }, FOLDERS)).toBe('/work/gone');
    expect(folderName({ directory: undefined }, FOLDERS)).toBeUndefined();
    expect(folderName({ directory: '' }, FOLDERS)).toBeUndefined();
  });
});

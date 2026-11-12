import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PendingAttachment } from '../../../src/webview/shared/types/domain';
import { AttachmentTray } from '../../../src/webview/features/attach-menu/ui/AttachmentTray';

function attachment(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return {
    id: 'a1',
    name: 'a.ts',
    uri: 'file:///repo/a.ts',
    kind: 'file',
    size: 0,
    ...overrides,
  };
}

describe('AttachmentTray', () => {
  it('renders nothing without attachments', () => {
    const { container } = render(<AttachmentTray attachments={[]} onRemove={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the kind and the formatted size of a file', () => {
    render(<AttachmentTray attachments={[attachment({ size: 2048 })]} onRemove={vi.fn()} />);

    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('file · 2 KB')).toBeInTheDocument();
  });

  it('falls back to the description when the host reports no size', () => {
    render(
      <AttachmentTray
        attachments={[attachment({ kind: 'selection', description: 'src/a.ts:3-5' })]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('selection · src/a.ts:3-5')).toBeInTheDocument();
  });

  it('counts the problems of a problems attachment', () => {
    const { rerender } = render(
      <AttachmentTray
        attachments={[
          attachment({
            kind: 'problems',
            context: { kind: 'problems', path: 'src/a.ts', problems: 3 },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('3 problems')).toBeInTheDocument();

    rerender(
      <AttachmentTray
        attachments={[
          attachment({
            kind: 'problems',
            context: { kind: 'problems', path: 'src/a.ts', problems: 1 },
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('1 problem')).toBeInTheDocument();
  });

  it('labels the automatic active-file chip', () => {
    render(
      <AttachmentTray
        attachments={[attachment({ auto: true, name: 'b.ts' })]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('active file')).toBeInTheDocument();
  });

  it('removes a chip from its button', () => {
    const onRemove = vi.fn();
    render(<AttachmentTray attachments={[attachment()]} onRemove={onRemove} />);

    fireEvent.click(screen.getByLabelText('Remove a.ts'));

    expect(onRemove).toHaveBeenCalledWith('a1');
  });

  it('renders an image preview with its name as alt text', () => {
    render(
      <AttachmentTray
        attachments={[
          attachment({ kind: 'image', name: 'shot.png', previewUri: 'vscode-resource://shot' }),
        ]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByAltText('shot.png')).toHaveAttribute('src', 'vscode-resource://shot');
  });
});

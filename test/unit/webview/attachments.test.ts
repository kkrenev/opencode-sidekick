import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  checkAttachLimit,
  formatAttachmentSize,
} from '../../../src/webview/features/attach-menu/lib/attachments';
import type { PendingAttachment } from '../../../src/webview/shared/types/domain';

function attachment(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return {
    id: 'a1',
    name: 'a.ts',
    uri: 'file:///repo/a.ts',
    kind: 'file',
    size: 100,
    ...overrides,
  };
}

describe('formatAttachmentSize', () => {
  it('prints bytes below a kilobyte', () => {
    expect(formatAttachmentSize(0)).toBe('0 B');
    expect(formatAttachmentSize(512)).toBe('512 B');
  });

  it('prints kilobytes below a megabyte', () => {
    expect(formatAttachmentSize(2048)).toBe('2 KB');
  });

  it('prints megabytes with one decimal', () => {
    expect(formatAttachmentSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('checkAttachLimit', () => {
  it('accepts a new attachment below both limits', () => {
    const candidate = attachment({ id: 'a2', uri: 'file:///repo/b.ts' });
    expect(checkAttachLimit([attachment()], candidate)).toEqual({ ok: true });
  });

  it('rejects a duplicate silently, because the chip is already there', () => {
    expect(checkAttachLimit([attachment()], attachment({ id: 'a2' }))).toEqual({
      ok: false,
      reason: 'a.ts is already attached.',
      silent: true,
    });
  });

  it('rejects an attachment over the count limit', () => {
    const existing = Array.from({ length: MAX_ATTACHMENTS }, (_unused, index) =>
      attachment({ id: `a${index}`, uri: `file:///repo/${index}.ts` }),
    );

    expect(checkAttachLimit(existing, attachment({ id: 'new', uri: 'file:///repo/new.ts' }))).toEqual(
      { ok: false, reason: `You can attach up to ${MAX_ATTACHMENTS} files.` },
    );
  });

  it('rejects an attachment over the size limit', () => {
    expect(
      checkAttachLimit([], attachment({ size: MAX_ATTACHMENT_BYTES + 1 })),
    ).toEqual({
      ok: false,
      reason: 'a.ts is larger than 10 MB.',
    });
  });
});

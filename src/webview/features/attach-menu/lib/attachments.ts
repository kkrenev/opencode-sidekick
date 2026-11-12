import type { PendingAttachment } from '../../../shared/types/domain';

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachAction = 'file' | 'folder' | 'selection' | 'screenshot' | 'problems';

export type AttachLimit =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly silent?: boolean };

export function checkAttachLimit(
  existing: readonly PendingAttachment[],
  candidate: PendingAttachment,
): AttachLimit {
  if (existing.some((attachment) => attachment.uri === candidate.uri)) {
    return { ok: false, reason: `${candidate.name} is already attached.`, silent: true };
  }
  if (existing.length >= MAX_ATTACHMENTS) {
    return { ok: false, reason: `You can attach up to ${MAX_ATTACHMENTS} files.` };
  }
  if (candidate.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `${candidate.name} is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
    };
  }
  return { ok: true };
}

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentSummary(attachments: readonly PendingAttachment[]): string {
  const names = attachments
    .map((attachment) => attachment.name)
    .filter((name) => name.length > 0)
    .join(', ');
  return names.length > 0 ? `[attachment] ${names}` : '[attachment]';
}

export function readFileDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
        return;
      }
      reject(new Error('Unable to read file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * How the transcript tells an image from a file. Pure string logic shared by
 * the host and its checks: no `vscode` import, because the module is compiled
 * next to the extension and required by a node check.
 */

/** Extensions the host treats as images, both in the tray and in the transcript. */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

/** Extensions opened by the editor's binary viewer instead of a text document. */
export const BINARY_EXTENSIONS = [...IMAGE_EXTENSIONS, '.ico', '.pdf'];

/**
 * Base64 payload a transcript frame may carry inline. A bigger `data:` image
 * keeps only its name, so every `messages` frame stays small.
 */
export const INLINE_IMAGE_LIMIT = 1_500_000;

export interface AttachmentIdentity {
  readonly uri?: string;
  readonly mime?: string;
  readonly name?: string;
}

/** MIME type of a `data:` URI; `undefined` for any other URI. */
export function mimeFromUri(uri: string | undefined): string | undefined {
  if (typeof uri !== 'string') {
    return undefined;
  }
  const match = /^data:([^;,]+)[;,]/.exec(uri);
  return match ? match[1].trim().toLowerCase() : undefined;
}

/** True when a `data:` payload fits the inline budget of one frame. */
export function inlineImageFits(uri: string): boolean {
  const comma = uri.indexOf(',');
  return comma !== -1 && uri.length - comma - 1 <= INLINE_IMAGE_LIMIT;
}

/** An image is decided by its MIME type, then by the extension of its name. */
export function isImageAttachment(identity: AttachmentIdentity): boolean {
  const mime = identity.mime ?? mimeFromUri(identity.uri);
  if (mime !== undefined && mime.toLowerCase().startsWith('image/')) {
    return true;
  }
  return IMAGE_EXTENSIONS.includes(extensionOf(identity.name ?? identity.uri ?? ''));
}

/** Last path segment of a URI or a path, without a query string. */
export function attachmentBaseName(value: string): string {
  // An inline payload has no filename: its tail is megabytes of base64.
  if (/^data:/i.test(value)) {
    return 'attachment';
  }
  const withoutQuery = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const slash = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'));
  const name = slash === -1 ? withoutQuery : withoutQuery.slice(slash + 1);
  return name.length > 0 ? name : 'attachment';
}

function extensionOf(value: string): string {
  const name = attachmentBaseName(value);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

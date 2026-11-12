import { RawMessage, RawPart, RawToolState } from './opencode-client';
import {
  attachmentBaseName,
  inlineImageFits,
  isImageAttachment,
  mimeFromUri,
} from './shared/attachment-kind';
import { fileUriPath, relativeToRoot } from './shared/open-target';

/**
 * One attachment of a message or of a tool result. `uri` is the raw `file:` or
 * `data:` URI and never a webview URI: the panel asks the host for a preview
 * lazily, because a webview URI is only valid in the webview that minted it.
 */
export interface UiAttachment {
  readonly kind: 'image' | 'file';
  readonly uri?: string;
  readonly name: string;
  readonly mime?: string;
  /** Workspace-relative path when the file sits inside a folder. */
  readonly path?: string;
  readonly line?: number;
  /** The inline payload was over the frame budget, so only the name is left. */
  readonly tooLarge?: boolean;
}

export type UiImagePart = {
  readonly kind: 'image';
  readonly uri?: string;
  readonly name: string;
  readonly mime?: string;
  readonly path?: string;
  readonly line?: number;
  readonly tooLarge?: boolean;
};

export type UiFilePart = {
  readonly kind: 'file';
  readonly uri?: string;
  readonly name: string;
  readonly mime?: string;
  readonly path?: string;
  readonly line?: number;
};

export type UiAttachmentPart = UiImagePart | UiFilePart;

export type UiPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string; readonly ms: number }
  | UiAttachmentPart
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly name: string;
      readonly status: 'running' | 'ok' | 'error';
      readonly title: string;
      readonly input: string;
      readonly output: string;
      /** Path the tool touched, when its input names one. */
      readonly path?: string;
      readonly line?: number;
      /** Files the tool returned, shown even while the card is collapsed. */
      readonly files?: readonly UiAttachment[];
    };

export interface UiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly time: number;
  /** Assistant completion time; a steering user message lands before it. */
  readonly completed?: number;
  readonly agent?: string;
  readonly model?: string;
  readonly parts: UiPart[];
}

const PATH_KEYS = ['filePath', 'path', 'file', 'filename'];
const PATTERN_KEYS = ['pattern', 'query', 'url', 'description'];
const LINE_KEYS = ['line', 'lineNumber', 'offset', 'startLine'];

export function mapMessages(
  messages: readonly RawMessage[],
  directories: readonly string[] = [],
): UiMessage[] {
  const result: UiMessage[] = [];

  for (const message of messages) {
    const role = message.type === 'user' ? 'user' : message.type === 'assistant' ? 'assistant' : undefined;
    if (!role) {
      continue;
    }

    const parts: UiPart[] = [];
    if (role === 'user') {
      const text = typeof message.text === 'string' ? message.text : '';
      if (text.trim().length > 0) {
        parts.push({ kind: 'text', text });
      }
      const seen = new Set<string>();
      for (const file of message.files ?? []) {
        const mapped = mapUserFile(file, directories, seen);
        if (mapped) {
          parts.push(mapped);
        }
      }
      // Some server builds report the prompt files as `file` parts instead of
      // `files`; both shapes end up as the same attachment, deduplicated.
      for (const part of message.content ?? []) {
        if (part.type !== 'file') {
          continue;
        }
        const mapped = mapUserFile(fileSource(part), directories, seen);
        if (mapped) {
          parts.push(mapped);
        }
      }
    } else {
      for (const part of message.content ?? []) {
        const mapped = mapPart(part, directories);
        if (mapped) {
          parts.push(mapped);
        }
      }
    }

    if (parts.length === 0) {
      continue;
    }

    result.push({
      id: message.id,
      role,
      time: message.time?.created ?? 0,
      completed: role === 'assistant' ? message.time?.completed : undefined,
      agent: role === 'assistant' ? message.agent : undefined,
      model: message.model?.id,
      parts,
    });
  }

  return result;
}

function mapPart(part: RawPart, directories: readonly string[]): UiPart | undefined {
  if (part.type === 'text') {
    const text = part.text ?? '';
    return text.length > 0 ? { kind: 'text', text } : undefined;
  }

  if (part.type === 'reasoning') {
    const text = part.text ?? '';
    if (text.length === 0) {
      return undefined;
    }
    const started = part.time?.created ?? 0;
    const ended = part.time?.completed ?? 0;
    return { kind: 'reasoning', text, ms: ended > started ? ended - started : 0 };
  }

  if (part.type === 'file') {
    return attachmentPart(fileSource(part), directories);
  }

  if (part.type === 'tool') {
    const state = part.state ?? {};
    const path = attachmentPath(
      firstString(...PATH_KEYS.map((key) => toolInputValue(state, key))),
      directories,
    );
    const line = path !== undefined ? toolLine(state) : undefined;
    return {
      kind: 'tool',
      id: part.id ?? part.name ?? 'tool',
      name: part.name ?? 'tool',
      status: toolStatus(state),
      title: toolTitle(part.name ?? 'tool', state),
      input: toolInput(state),
      output: toolOutput(state),
      ...(path !== undefined ? { path } : {}),
      ...(line !== undefined ? { line } : {}),
      ...toolFiles(state, directories),
    };
  }

  return undefined;
}

/** A `file` part, whichever of its URI, URL or filename fields the server set. */
function fileSource(part: RawPart): { uri?: string; mime?: string; name?: string } {
  return {
    uri: firstString(part.uri, part.url, part.filename),
    mime: part.mime,
    name: firstString(part.name, part.filename),
  };
}

/** A user prompt file; `data:text/plain` keeps its name but never its payload. */
function mapUserFile(
  file: { readonly uri?: string; readonly name?: string; readonly mime?: string },
  directories: readonly string[],
  seen: Set<string>,
): UiAttachmentPart | undefined {
  const uri = firstString(file.uri);
  const name = displayName(file.name, uri);
  const key = uri ?? name;
  if (key.length === 0 || seen.has(key)) {
    return undefined;
  }
  seen.add(key);
  return attachmentPart({ uri, mime: file.mime, name }, directories);
}

function attachmentPart(
  source: { uri?: string; mime?: string; name?: string },
  directories: readonly string[],
): UiAttachmentPart {
  const rawUri = firstString(source.uri);
  const mime = firstString(source.mime) ?? mimeFromUri(rawUri);
  const name = displayName(source.name, rawUri);
  const image = isImageAttachment({ uri: rawUri, mime, name });
  const uri = transcriptUri(rawUri, image);
  const tooLarge = image && uri === undefined && isInlineUri(rawUri);
  const path = attachmentPath(rawUri, directories);
  const fields = {
    ...(uri !== undefined ? { uri } : {}),
    name,
    ...(mime !== undefined ? { mime } : {}),
    ...(path !== undefined ? { path } : {}),
  };
  if (image) {
    return { kind: 'image', ...fields, ...(tooLarge ? { tooLarge: true } : {}) };
  }
  return { kind: 'file', ...fields };
}

/**
 * The URI the transcript may carry: a `file:` URI always, an inline image only
 * while it fits one frame. A selection payload never travels with the message.
 */
function transcriptUri(rawUri: string | undefined, image: boolean): string | undefined {
  if (typeof rawUri !== 'string' || rawUri.length === 0) {
    return undefined;
  }
  if (/^file:/i.test(rawUri)) {
    return rawUri;
  }
  // Only an inline image small enough for one frame keeps its payload.
  if (isInlineUri(rawUri)) {
    return image && inlineImageFits(rawUri) ? rawUri : undefined;
  }
  // A bare path is not a URI: it opens through `path` and never as an image.
  return undefined;
}

/** A path the host can open: relative when it sits inside a folder. */
function attachmentPath(
  rawUri: string | undefined,
  directories: readonly string[],
): string | undefined {
  if (typeof rawUri !== 'string' || rawUri.length === 0) {
    return undefined;
  }
  const fsPath = fileUriPath(rawUri);
  if (fsPath !== undefined) {
    // Outside a folder the chip keeps its name and opens through the URI, so an
    // absolute path from global storage never leaks into the transcript.
    return relativeToRoot(directories, fsPath);
  }
  if (
    isInlineUri(rawUri) ||
    (/^[a-z][a-z0-9+.-]*:/i.test(rawUri) && !/^[A-Za-z]:[\\/]/.test(rawUri))
  ) {
    return undefined;
  }
  return rawUri;
}

/** Files a tool returned; they render even while the card is collapsed. */
function toolFiles(
  state: RawToolState,
  directories: readonly string[],
): { files?: readonly UiAttachment[] } {
  if (!Array.isArray(state.content)) {
    return {};
  }
  const files: UiAttachment[] = [];
  const seen = new Set<string>();
  for (const entry of state.content) {
    if (!entry || typeof entry !== 'object' || (entry as { type?: unknown }).type !== 'file') {
      continue;
    }
    const record = entry as {
      readonly uri?: unknown;
      readonly url?: unknown;
      readonly mime?: unknown;
      readonly name?: unknown;
      readonly filename?: unknown;
    };
    const uri = firstString(record.uri, record.url, record.filename);
    const name = displayName(firstString(record.name, record.filename), uri);
    const key = uri ?? name;
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    files.push(
      attachmentPart({ uri, mime: firstString(record.mime), name }, directories),
    );
  }
  return files.length > 0 ? { files } : {};
}

function toolInputValue(state: RawToolState, key: string): string | undefined {
  const input = state.input;
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Line a tool input points at; `offset` is 0-based, the others are 1-based. */
function toolLine(state: RawToolState): number | undefined {
  const input = state.input;
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of LINE_KEYS) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const line = Math.floor(value);
    if (key === 'offset') {
      return line >= 0 ? line + 1 : undefined;
    }
    return line >= 1 ? line : undefined;
  }
  return undefined;
}

function displayName(name: string | undefined, uri: string | undefined): string {
  const value = firstString(name);
  if (value !== undefined) {
    return value;
  }
  return typeof uri === 'string' && uri.length > 0 ? attachmentBaseName(uri) : 'attachment';
}

function isInlineUri(uri: string | undefined): boolean {
  return typeof uri === 'string' && /^data:/i.test(uri);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function toolStatus(state: RawToolState): 'running' | 'ok' | 'error' {
  if (state.status === 'error') {
    return 'error';
  }
  if (state.status === 'completed') {
    return 'ok';
  }
  return 'running';
}

function toolTitle(name: string, state: RawToolState): string {
  const input = state.input;
  if (typeof input === 'string') {
    return truncate(input, 90);
  }
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if (name === 'shell' || name === 'bash' || name === 'terminal') {
      const command = record.command;
      if (typeof command === 'string') {
        return truncate(command.split('\n')[0], 90);
      }
    }
    for (const key of PATH_KEYS) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }
    for (const key of PATTERN_KEYS) {
      const value = record[key];
      if (typeof value === 'string') {
        return truncate(value, 90);
      }
    }
  }
  return name;
}

function toolInput(state: RawToolState): string {
  const input = state.input;
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toolOutput(state: RawToolState): string {
  if (state.status === 'error') {
    return errorText(state.error);
  }
  if (Array.isArray(state.content)) {
    return state.content
      .map((entry) => {
        if (entry && typeof entry === 'object' && 'text' in entry) {
          const text = (entry as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }
  if (typeof state.output === 'string') {
    return state.output;
  }
  if (state.output !== undefined) {
    try {
      return JSON.stringify(state.output, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function errorText(error: unknown): string {
  if (!error) {
    return 'Tool failed';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') {
      return record.message;
    }
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return 'Tool failed';
  }
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/**
 * Markdown export of a transcript, shared by the host and the webview. It must
 * stay free of `vscode` and React imports: the extension compiles it to
 * `out/shared` and esbuild bundles it into the panel.
 */

export const TRANSCRIPT_LIMIT_BYTES = 5 * 1024 * 1024;
export const TRANSCRIPT_MESSAGE_LIMIT = 2000;

export type TranscriptTruncation = 'messages' | 'bytes';

/** Structurally compatible with the host and the webview `UiMessage`. */
export interface TranscriptPart {
  readonly kind: string;
  readonly text?: string;
  readonly name?: string;
  readonly status?: string;
  readonly title?: string;
}

export interface TranscriptMessage {
  readonly role: 'user' | 'assistant';
  readonly parts: readonly TranscriptPart[];
}

export interface TranscriptOptions {
  readonly title?: string;
  readonly exportedAt?: Date;
  /** Why the caller stopped reading before the end of the session. */
  readonly truncated?: TranscriptTruncation;
}

/**
 * Text the user sees: text parts only, joined as paragraphs. Reasoning and
 * tool parts never leak into a message copy.
 */
export function messageText(message: TranscriptMessage): string {
  return message.parts
    .filter((part) => part.kind === 'text')
    .map((part) => part.text ?? '')
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .trim();
}

/**
 * Whole-conversation markdown: one section per message, tool calls reduced to a
 * single line without their output, and a hard byte limit so a huge session
 * still copies something instead of hanging the clipboard.
 */
export function formatTranscriptMarkdown(
  messages: readonly TranscriptMessage[],
  options: TranscriptOptions = {},
): string {
  const blocks: string[] = [];
  let bytes = 0;
  let truncated = options.truncated;

  const push = (block: string): boolean => {
    const cost = utf8Length(block) + (blocks.length > 0 ? 2 : 0);
    if (bytes + cost > TRANSCRIPT_LIMIT_BYTES) {
      // The byte cut is the more precise reason: the output stopped mid-message.
      truncated = 'bytes';
      return false;
    }
    blocks.push(block);
    bytes += cost;
    return true;
  };

  // A section is pushed whole: a byte cut must not leave a role heading with
  // no text under it at the end of the export.
  const fitsSection = (section: readonly string[]): boolean => {
    let size = bytes;
    let count = blocks.length;
    for (const block of section) {
      size += utf8Length(block) + (count > 0 ? 2 : 0);
      count += 1;
    }
    return size <= TRANSCRIPT_LIMIT_BYTES;
  };

  push(`# ${(options.title ?? '').trim() || 'Conversation'}`);
  push(`_Exported ${stamp(options.exportedAt ?? new Date())}_`);

  for (const message of messages) {
    const text = messageText(message);
    const tools = message.parts
      .map(toolLine)
      .filter((line): line is string => line !== undefined);
    if (text.length === 0 && tools.length === 0) {
      continue;
    }
    const section = [`## ${message.role === 'user' ? 'User' : 'Assistant'}`];
    if (text.length > 0) {
      section.push(text);
    }
    section.push(...tools);
    if (!fitsSection(section)) {
      truncated = 'bytes';
      break;
    }
    if (!section.every((block) => push(block))) {
      break;
    }
  }

  if (truncated) {
    blocks.push(truncationNote(truncated));
  }
  return blocks.join('\n\n');
}

function truncationNote(reason: TranscriptTruncation): string {
  return reason === 'messages'
    ? `_Transcript truncated (${TRANSCRIPT_MESSAGE_LIMIT} messages)._`
    : '_Transcript truncated at 5 MB._';
}

/** `> tool: name — title [status]`, never the tool input or output. */
function toolLine(part: TranscriptPart): string | undefined {
  if (part.kind !== 'tool') {
    return undefined;
  }
  const name = (part.name ?? '').trim() || 'tool';
  const title = (part.title ?? '').replace(/\s+/g, ' ').trim();
  const status = (part.status ?? '').trim();
  return `> tool: ${name}${title.length > 0 ? ` — ${title}` : ''}${status.length > 0 ? ` [${status}]` : ''}`;
}

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

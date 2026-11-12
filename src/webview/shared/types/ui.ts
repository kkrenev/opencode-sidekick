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
  readonly agent?: string;
  readonly model?: string;
  readonly parts: UiPart[];
}

/** What a transcript chip asks the host to open; a URI wins over a path. */
export type { OpenPathRequest as OpenPathTarget } from '../../../shared/open-target';

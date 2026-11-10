export type UiPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string; readonly ms: number }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly name: string;
      readonly status: 'running' | 'ok' | 'error';
      readonly title: string;
      readonly input: string;
      readonly output: string;
    };

export interface UiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly time: number;
  readonly agent?: string;
  readonly model?: string;
  readonly parts: UiPart[];
}

export interface RuntimeModelSelection {
  readonly id: string;
  readonly providerID: string;
  readonly variant?: string;
}

export interface SessionRuntimeState {
  readonly draft: string;
  readonly scrollTop: number;
  readonly stickToBottom: boolean;
  readonly distanceFromBottom: number;
  readonly toggles: Record<string, boolean>;
  readonly caret: number;
  readonly selectionEnd: number;
  readonly model?: RuntimeModelSelection;
  readonly effort?: string;
  readonly mode?: string;
}

export const EMPTY_SESSION_RUNTIME: SessionRuntimeState = {
  draft: '',
  scrollTop: 0,
  stickToBottom: true,
  distanceFromBottom: 0,
  toggles: {},
  caret: 0,
  selectionEnd: 0,
};

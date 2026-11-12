import type { FileDiffInfo, TurnDiffInit } from '../../../shared/turn-diff';

/** Host to panel: the turn to show and the turns around it. */
export interface DiffInitMessage {
  readonly type: 'init';
  readonly init: TurnDiffInit;
}

/** Host to panel: patches of one turn. */
export interface DiffResultMessage {
  readonly type: 'diffResult';
  readonly requestId: string;
  readonly sessionID: string;
  readonly from: string;
  readonly files: readonly FileDiffInfo[];
  readonly truncated?: boolean;
  readonly tooLarge?: boolean;
}

export interface DiffErrorMessage {
  readonly type: 'diffError';
  readonly requestId: string;
  readonly message: string;
}

/** Host → panel: result of the clipboard write for one copy request. */
export interface DiffCopiedMessage {
  readonly type: 'copied';
  readonly requestId: string;
  readonly ok: boolean;
}

export type DiffIncoming =
  | DiffInitMessage
  | DiffResultMessage
  | DiffErrorMessage
  | DiffCopiedMessage;

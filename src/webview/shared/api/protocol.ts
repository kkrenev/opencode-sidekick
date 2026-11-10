import type { FileEntry, SessionSummary } from '../types/domain';
import type { AppData } from '../types/snapshot';
import type { UiMessage } from '../types/ui';

export interface IncomingMessage {
  readonly type: string;
  readonly state?: AppData;
  readonly messages?: readonly UiMessage[];
  readonly sessions?: readonly SessionSummary[];
  readonly session?: SessionSummary;
  readonly busy?: boolean;
  readonly messageID?: string;
  readonly kind?: 'text' | 'reasoning';
  readonly delta?: string;
  readonly message?: string;
  readonly target?: string;
  readonly query?: string;
  readonly requestId?: string;
  readonly items?: readonly FileEntry[];
}

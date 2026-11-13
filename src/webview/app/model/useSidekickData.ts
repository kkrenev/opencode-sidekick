import * as React from 'react';
import { post, subscribeToHost } from '../../shared/api/vscode';
import { DEFAULT_SETTINGS } from '../../shared/config/settings';
import type { AppData } from '../../shared/types/snapshot';
import { applyDelta } from './applyDelta';

const INITIAL_DATA: AppData = {
  connected: false,
  error: null,
  resendPending: false,
  directory: '',
  workspace: '',
  folders: [],
  activeDirectory: '',
  session: null,
  sessions: [],
  historyScope: 'folder',
  historySessions: [],
  tabs: [],
  messages: [],
  history: { hasMoreOlder: false, loadingOlder: false },
  models: [],
  agents: [],
  commands: [],
  skills: [],
  defaultModel: null,
  defaults: {},
  settings: DEFAULT_SETTINGS,
  busy: false,
  model: null,
  agent: null,
  runtime: null,
  usage: { used: null, level: 'unknown', compacting: false, compacted: false },
  notices: [],
  turnDiff: null,
  revert: null,
  revertPending: false,
  permissions: [],
  permissionSending: [],
  queue: [],
  queuePending: [],
  savedPermissions: [],
  savedPermissionsError: null,
  savedPermissionsHint: null,
};

export function useSidekickData({
  showToast,
  onFocus,
  openHistory,
  closeHistory,
  openSettings,
}: {
  showToast: (message: string) => void;
  onFocus: () => void;
  openHistory: () => void;
  closeHistory: () => void;
  openSettings: () => void;
}) {
  const [data, setData] = React.useState<AppData>(INITIAL_DATA);

  React.useEffect(() => {
    const unsubscribe = subscribeToHost((message) => {
      switch (message.type) {
        case 'state': {
          const nextState = message.state;
          if (nextState) {
            setData((previous) => ({
              ...previous,
              ...nextState,
              defaults: nextState.defaults ?? previous.defaults,
              settings: nextState.settings ?? previous.settings,
              history: nextState.history ?? previous.history,
            }));
          }
          break;
        }
        case 'messages':
          setData((previous) => ({
            ...previous,
            messages: message.messages ?? [],
          }));
          break;
        case 'sessions':
          setData((previous) => ({
            ...previous,
            // A workspace answer belongs to the drawer's own list: the active
            // folder's `sessions` must keep feeding the tab strip and the chat.
            ...(message.scope === 'workspace'
              ? { historySessions: message.sessions ?? previous.historySessions }
              : { sessions: message.sessions ?? previous.sessions }),
            session: message.session ?? previous.session,
            tabs: message.tabs ?? previous.tabs,
          }));
          break;
        case 'busy':
          setData((previous) => ({ ...previous, busy: message.busy === true }));
          break;
        case 'delta':
          if (message.messageID && message.kind && typeof message.delta === 'string') {
            setData((previous) =>
              applyDelta(previous, message.messageID!, message.kind!, message.delta!),
            );
          }
          break;
        case 'error':
          showToast(message.message || 'OpenCode request failed');
          break;
        case 'toast':
          if (message.text) {
            showToast(message.text);
          }
          break;
        case 'focus':
          onFocus();
          break;
        case 'openHistory':
          openHistory();
          break;
        case 'closeHistory':
          closeHistory();
          break;
        case 'openSettings':
          openSettings();
          break;
        default:
          break;
      }
    });
    post({ type: 'ready' });
    return unsubscribe;
  }, [showToast, onFocus, openHistory, closeHistory, openSettings]);

  return { data, setData };
}

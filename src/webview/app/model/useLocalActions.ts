import * as React from 'react';
import { modelEntryFor } from '../../entities/model/lib/model';
import { post } from '../../shared/api/vscode';
import type { AppData } from '../../shared/types/snapshot';
import { chipAnchor } from './chipAnchor';
import type { useSidekickUi } from './useSidekickUi';

type UiController = ReturnType<typeof useSidekickUi>;

export function useLocalActions({
  data,
  ui,
}: {
  data: AppData;
  ui: UiController;
}): (action: string) => void {
  return React.useCallback(
    (action: string) => {
      switch (action) {
        case 'new':
          ui.setHistoryOpen(false);
          ui.setSettingsOpen(false);
          ui.setPopover(null);
          post({ type: 'newSession' });
          break;
        case 'history':
          ui.openHistory();
          break;
        case 'models':
          if (data.models.length === 0) {
            ui.showToast('No models reported by the server yet.');
            return;
          }
          ui.openPicker('model', chipAnchor('model'));
          break;
        case 'effort':
          if (!modelEntryFor(data.models, data.model ?? data.defaults.model)) {
            ui.showToast('Choose a model first.');
            return;
          }
          ui.openPicker('effort', chipAnchor('effort'));
          break;
        case 'agents':
          if (data.agents.length === 0) {
            ui.showToast('No agents reported by the server yet.');
            return;
          }
          ui.openPicker('mode', chipAnchor('mode'));
          break;
        case 'settings':
          ui.openSettings();
          break;
        case 'reload':
          post({ type: 'refresh' });
          break;
        case 'browser':
          post({ type: 'openBrowser' });
          break;
        case 'terminal':
          post({ type: 'openTerminal' });
          break;
        case 'help':
          ui.showToast('Type / for commands and @ for files and skills.');
          break;
        default:
          break;
      }
    },
    [data.agents.length, data.defaults.model, data.model, data.models, ui],
  );
}

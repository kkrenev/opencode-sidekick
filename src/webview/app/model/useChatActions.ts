import * as React from 'react';
import { matchLocalCommand } from '../../features/composer-palette/lib/palette';
import { modelEntryFor, preservedVariant } from '../../entities/model/lib/model';
import { post } from '../../shared/api/vscode';
import { DEFAULT_SETTINGS } from '../../shared/config/settings';
import type { ModelEntry } from '../../shared/types/domain';
import type { AppData } from '../../shared/types/snapshot';
import type { useComposerPalette } from './useComposerPalette';
import type { useSidekickUi } from './useSidekickUi';

type UiController = ReturnType<typeof useSidekickUi>;
type PaletteController = ReturnType<typeof useComposerPalette>;

export function useChatActions({
  data,
  setData,
  ui,
  palette,
  inputRef,
  runLocalAction,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  ui: UiController;
  palette: PaletteController;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  runLocalAction: (action: string) => void;
}) {
  const effectiveModel = data.model ?? data.defaults.model ?? undefined;
  const effectiveModelEntry = modelEntryFor(data.models, effectiveModel);

  const send = React.useCallback(() => {
    if (palette.palette) {
      palette.acceptPalette(palette.activeIndex);
      return;
    }
    const text = ui.draft.trim();
    if (text.length === 0) {
      return;
    }
    const local = matchLocalCommand(text);
    if (local) {
      ui.setDraft('');
      runLocalAction(local.action);
      return;
    }
    ui.setDraft('');
    ui.setPopover(null);
    setData((previous) => ({
      ...previous,
      messages: [
        ...previous.messages,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          time: Date.now(),
          parts: [{ kind: 'text', text }],
        },
      ],
      busy: true,
    }));
    post({ type: 'send', text });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [palette, ui, runLocalAction, setData, inputRef]);

  const onComposerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (palette.palette) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (palette.paletteItems.length > 0) {
            palette.setActiveIndex((value) => (value + 1) % palette.paletteItems.length);
          }
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (palette.paletteItems.length > 0) {
            palette.setActiveIndex(
              (value) => (value - 1 + palette.paletteItems.length) % palette.paletteItems.length,
            );
          }
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          palette.acceptPalette(palette.activeIndex);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          palette.closePalette();
          return;
        }
      }

      const sendWithMod = event.metaKey || event.ctrlKey;
      const shouldSend =
        !event.nativeEvent.isComposing &&
        event.key === 'Enter' &&
        !event.shiftKey &&
        (data.settings.sendKey === 'enter' || sendWithMod);
      if (shouldSend) {
        event.preventDefault();
        send();
      }
    },
    [palette, data.settings.sendKey, send],
  );

  const pickModel = React.useCallback(
    (model: ModelEntry) => {
      post({
        type: 'selectModel',
        selection: {
          id: model.id,
          providerID: model.providerID,
          variant: preservedVariant(model, data.model?.variant),
        },
      });
      ui.setPopover(null);
    },
    [data.model?.variant, ui],
  );

  const pickEffort = React.useCallback(
    (variant: string | undefined) => {
      if (!effectiveModel) {
        ui.showToast('Choose a model first.');
        return;
      }
      post({
        type: 'selectModel',
        selection: {
          id: effectiveModel.id,
          providerID: effectiveModel.providerID,
          variant,
        },
      });
      ui.setPopover(null);
    },
    [effectiveModel, ui],
  );

  const pickMode = React.useCallback(
    (id: string) => {
      post({ type: 'selectAgent', agent: id });
      ui.setPopover(null);
    },
    [ui],
  );

  const updateSetting = React.useCallback(
    (key: keyof typeof DEFAULT_SETTINGS, value: unknown) => {
      setData((previous) => ({
        ...previous,
        settings: { ...previous.settings, [key]: value } as AppData['settings'],
      }));
      post({ type: 'updateSetting', key, value });
    },
    [setData],
  );

  const resetSettings = React.useCallback(() => {
    setData((previous) => ({ ...previous, settings: DEFAULT_SETTINGS }));
    post({ type: 'resetSettings' });
  }, [setData]);

  const newSession = React.useCallback(() => {
    ui.setHistoryOpen(false);
    ui.setSettingsOpen(false);
    ui.setPopover(null);
    post({ type: 'newSession' });
  }, [ui]);

  const openSession = React.useCallback(
    (id: string) => {
      post({ type: 'openSession', id });
      ui.setHistoryOpen(false);
      ui.setHistoryQuery('');
    },
    [ui],
  );

  const deleteSession = React.useCallback((id: string) => {
    post({ type: 'deleteSession', id });
  }, []);

  return {
    effectiveModel,
    effectiveModelEntry,
    send,
    stop: () => post({ type: 'stop' }),
    retry: () => post({ type: 'refresh' }),
    onComposerKeyDown,
    pickModel,
    pickEffort,
    pickMode,
    updateSetting,
    resetSettings,
    newSession,
    openSession,
    deleteSession,
    applySuggestion: (text: string) => {
      ui.setDraft(text);
      inputRef.current?.focus();
    },
  };
}

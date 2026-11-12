import * as React from 'react';
import { attachmentSummary } from '../../features/attach-menu/lib/attachments';
import { matchLocalCommand } from '../../features/composer-palette/lib/palette';
import { modelEntryFor, preservedVariant } from '../../entities/model/lib/model';
import { post, subscribeToHost } from '../../shared/api/vscode';
import { DEFAULT_SETTINGS } from '../../shared/config/settings';
import type { ModelEntry, PendingAttachment } from '../../shared/types/domain';
import type { AppData } from '../../shared/types/snapshot';
import type { useAttachments } from './useAttachments';
import type { useComposerPalette } from './useComposerPalette';
import type { useSessionRuntime } from './useSessionRuntime';
import type { useSidekickUi } from './useSidekickUi';

type UiController = ReturnType<typeof useSidekickUi>;
type SessionController = ReturnType<typeof useSessionRuntime>;
type PaletteController = ReturnType<typeof useComposerPalette>;
type AttachmentsController = ReturnType<typeof useAttachments>;

export function useChatActions({
  data,
  setData,
  ui,
  session,
  palette,
  attachments,
  inputRef,
  runLocalAction,
}: {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  ui: UiController;
  session: SessionController;
  palette: PaletteController;
  attachments: AttachmentsController;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  runLocalAction: (action: string) => void;
}) {
  const effectiveModel = data.model ?? data.defaults.model ?? undefined;
  const effectiveModelEntry = modelEntryFor(data.models, effectiveModel);
  const lastSent = React.useRef<readonly PendingAttachment[]>([]);
  /** Whether the last send added an optimistic bubble that may need removal. */
  const optimistic = React.useRef(false);

  React.useEffect(() => {
    return subscribeToHost((message) => {
      if (message.type === 'queueEdit') {
        // The host cancelled the queued prompt; its text returns here so the
        // user can change it before sending again. An existing draft is kept:
        // replacing it would silently throw away what the user was typing.
        const text = typeof message.text === 'string' ? message.text : '';
        if (text.length === 0) {
          return;
        }
        session.setDraft((current) =>
          current.trim().length === 0 ? text : `${current}\n\n${text}`,
        );
        window.requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (message.type === 'sendAccepted') {
        // The host confirmed the repeated send, so the draft and the chips it
        // put back must not stay: the next Send would send them a second time.
        // Anything the user changed meanwhile is theirs and stays.
        if (message.sessionID !== undefined && message.sessionID !== data.session?.id) {
          return;
        }
        const text = typeof message.text === 'string' ? message.text : '';
        session.setDraft((current) => (current.trim() === text ? '' : current));
        attachments.consume(new Set((message.attachments ?? []).map((entry) => entry.uri)));
        return;
      }
      if (message.type !== 'sendRejected') {
        return;
      }
      if (message.sessionID !== undefined && message.sessionID !== data.session?.id) {
        ui.showToast(message.message || 'The message was not sent.');
        return;
      }
      // A repeated send must not overwrite the composer: the draft and the
      // chips of the failed send are already here, and the user may have edited
      // them since. An empty composer still takes the payload back, so a draft
      // the user cleared before the repeat is not lost.
      const resend = message.resend === true;
      const snapshot = lastSent.current;
      if (!resend) {
        lastSent.current = [];
      }
      const restored = (message.attachments ?? []).map((entry) => {
        const known = snapshot.find((attachment) => attachment.uri === entry.uri);
        if (known) {
          return known;
        }
        return {
          id: entry.uri,
          name: entry.name ?? 'attachment',
          uri: entry.uri,
          kind: 'file' as const,
          size: 0,
          ...(entry.context ? { context: entry.context } : {}),
        };
      });
      attachments.restore(restored.length > 0 ? restored : snapshot);
      const text = typeof message.text === 'string' ? message.text : '';
      if (resend) {
        session.setDraft((current) => (current.trim().length === 0 ? text : current));
      } else {
        session.setDraft(text);
      }
      // Only a send that painted a local bubble may remove one; a queued send
      // never added a bubble, so the previous message must stay untouched.
      const hadOptimistic = optimistic.current;
      optimistic.current = false;
      setData((previous) => {
        const messages = [...previous.messages];
        const last = messages[messages.length - 1];
        if (
          hadOptimistic &&
          last &&
          last.role === 'user' &&
          last.id.startsWith('local-')
        ) {
          messages.pop();
        }
        // A rejected queued send leaves the running turn alone: the host sends
        // its own busy state so the composer does not stop working.
        const busy = typeof message.busy === 'boolean' ? message.busy : false;
        return { ...previous, messages, busy };
      });
      ui.showToast(message.message || 'The message was not sent.');
    });
  }, [
    attachments.consume,
    attachments.restore,
    data.session?.id,
    session.setDraft,
    setData,
    ui.showToast,
    inputRef,
  ]);

  const send = React.useCallback(() => {
    if (palette.palette) {
      palette.acceptPalette(palette.activeIndex);
      return;
    }
    const text = session.draft.trim();
    const pending = attachments.items;
    if (text.length === 0 && pending.length === 0) {
      return;
    }
    const local = matchLocalCommand(text);
    if (local) {
      session.setDraft('');
      runLocalAction(local.action);
      return;
    }
    if (pending.length > 0 && text.startsWith('/')) {
      ui.showToast('Attachments are not sent with slash commands.');
      return;
    }
    if (data.revertPending) {
      ui.showToast('Wait for the current revert to finish');
      return;
    }
    if (data.revert) {
      // Sending would make the server commit the staged revert.
      ui.showToast('Keep or undo the revert first');
      return;
    }
    const files = pending.map((attachment) => ({
      uri: attachment.uri,
      name: attachment.name,
      ...(attachment.context ? { context: attachment.context } : {}),
    }));
    // While a turn runs the message waits in the server inbox unless the user
    // asked for steering; a slash command always runs immediately.
    const queueing =
      data.busy && data.settings.queueDelivery === 'queue' && !text.startsWith('/');
    lastSent.current = pending;
    optimistic.current = !queueing;
    session.setDraft('');
    attachments.clear();
    ui.setPopover(null);
    if (!queueing) {
      setData((previous) => ({
        ...previous,
        messages: [
          ...previous.messages,
          {
            id: `local-${Date.now()}`,
            role: 'user',
            time: Date.now(),
            parts: [{ kind: 'text', text: text.length > 0 ? text : attachmentSummary(pending) }],
          },
        ],
        busy: true,
      }));
    }
    post({
      type: 'send',
      text,
      attachments: files,
      ...(queueing ? { delivery: 'queue' } : {}),
    });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [
    attachments,
    data.busy,
    data.revert,
    data.revertPending,
    data.settings.queueDelivery,
    palette,
    session,
    runLocalAction,
    setData,
    ui,
    inputRef,
  ]);

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
    resend: () => post({ type: 'resend' }),
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
      session.setDraft(text);
      const element = inputRef.current;
      element?.focus();
      element?.setSelectionRange(text.length, text.length);
      session.setCaret(text.length, text.length);
    },
  };
}

import * as React from 'react';
import { chipAnchor } from './model/chipAnchor';
import { useAttachments } from './model/useAttachments';
import { useChatActions } from './model/useChatActions';
import { useComposerPalette } from './model/useComposerPalette';
import { useLocalActions } from './model/useLocalActions';
import { useSidekickData } from './model/useSidekickData';
import { useSessionRuntime } from './model/useSessionRuntime';
import { useSessionTabs } from './model/useSessionTabs';
import { useSidekickUi } from './model/useSidekickUi';
import { agentName, effectiveAgent } from '../entities/agent/lib/agent';
import { effortText, modelName } from '../entities/model/lib/model';
import { AppMenu } from '../features/app-menu/ui/AppMenu';
import { AttachMenu } from '../features/attach-menu/ui/AttachMenu';
import type { AttachAction } from '../features/attach-menu/lib/attachments';
import { ComposerPalette } from '../features/composer-palette/ui/ComposerPalette';
import { EffortPicker } from '../features/effort-picker/ui/EffortPicker';
import { MessageMenu } from '../features/message-menu/ui/MessageMenu';
import { ModePicker } from '../features/mode-picker/ui/ModePicker';
import { ModelPicker } from '../features/model-picker/ui/ModelPicker';
import { TabMenu } from '../features/tab-menu/ui/TabMenu';
import { ChatHeader } from '../widgets/chat-header/ui/ChatHeader';
import { Composer } from '../widgets/composer/ui/Composer';
import { QueueStrip } from '../widgets/composer/ui/QueueStrip';
import { pastedTextFile } from '../widgets/composer/lib/paste';
import { Conversation, type UndoRequest } from '../widgets/conversation/ui/Conversation';
import { SessionHistory } from '../widgets/session-history/ui/SessionHistory';
import { SettingsDrawer } from '../widgets/settings-drawer/ui/SettingsDrawer';
import { post } from '../shared/api/vscode';
import { messageText } from '../../shared/transcript-markdown';
import type { UiMessage } from '../shared/types/ui';

export function App(): React.ReactElement {
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const composerRef = React.useRef<HTMLDivElement | null>(null);
  const ui = useSidekickUi();
  const focusComposer = React.useCallback(() => inputRef.current?.focus(), []);
  const { data, setData } = useSidekickData({
    showToast: ui.showToast,
    onFocus: focusComposer,
    openHistory: ui.openHistory,
    closeHistory: ui.closeHistory,
    openSettings: ui.openSettings,
  });
  const {
    activateTab,
    closeTab,
    renameTab,
    pinTab,
    archiveTab,
    forkTab,
    openInEditor,
    copyId,
    deleteTab,
  } = useSessionTabs({
    tabs: data.tabs,
    activeId: data.session?.id ?? null,
    showToast: ui.showToast,
  });
  const session = useSessionRuntime({
    activeId: data.session?.id ?? null,
    directory: data.activeDirectory,
    runtime: data.runtime,
    model: data.model,
    mode: data.agent,
  });
  const runLocalAction = useLocalActions({ data, ui });
  const palette = useComposerPalette({
    data,
    draft: session.draft,
    setDraft: session.setDraft,
    inputRef,
    dismissPopover: () => ui.setPopover(null),
    onLocalAction: runLocalAction,
    onCaret: (caret) => session.setCaret(caret, caret),
  });
  const attachments = useAttachments({
    sessionId: data.session?.id ?? null,
    directory: data.activeDirectory,
    showToast: ui.showToast,
  });
  const actions = useChatActions({
    data,
    setData,
    ui,
    session,
    palette,
    attachments,
    inputRef,
    runLocalAction,
  });

  React.useEffect(() => {
    document.body.dataset.accent = data.settings.accent;
    document.body.dataset.density = data.settings.density;
    document.body.dataset.fontSize = data.settings.fontSize;
  }, [data.settings.accent, data.settings.density, data.settings.fontSize]);

  const effectiveAgentId = effectiveAgent(data.agent, data.defaults.mode);
  const modelLabel = modelName(data.models, actions.effectiveModel);
  const effortLabel = effortText(data.model, data.defaults, actions.effectiveModelEntry);
  const modeLabel = agentName(data.agents, effectiveAgentId);

  const openModel = (anchor: HTMLElement | null) => {
    if (data.models.length === 0) {
      ui.showToast('No models reported by the server yet.');
      return;
    }
    ui.openPicker('model', anchor);
  };
  const openEffort = (anchor: HTMLElement | null) => {
    if (!actions.effectiveModelEntry) {
      ui.showToast('Choose a model first.');
      return;
    }
    ui.openPicker('effort', anchor);
  };
  const openMode = (anchor: HTMLElement | null) => {
    if (data.agents.length === 0) {
      ui.showToast('No agents reported by the server yet.');
      return;
    }
    ui.openPicker('mode', anchor);
  };
  const pickAttachment = (action: AttachAction) => {
    ui.setPopover(null);
    switch (action) {
      case 'file':
        attachments.attachFile();
        break;
      case 'folder':
        attachments.attachFolder();
        break;
      case 'selection':
        attachments.attachSelection();
        break;
      case 'problems':
        attachments.attachProblems();
        break;
      case 'screenshot':
        attachments.attachScreenshot();
        break;
    }
  };

  const commitRename = () => {
    const current = ui.rename;
    ui.cancelRename();
    if (!current) {
      return;
    }
    const title = current.draft.trim();
    if (title.length === 0 || title === current.title) {
      return;
    }
    renameTab(current.id, title);
  };

  const tabPopover = ui.popover?.kind === 'tab' ? ui.popover : null;
  const menuTab = tabPopover
    ? data.tabs.find((entry) => entry.id === tabPopover.id)
    : undefined;
  const messagePopover = ui.popover?.kind === 'message' ? ui.popover : null;
  const menuMessage = messagePopover
    ? data.messages.find((entry) => entry.id === messagePopover.id)
    : undefined;

  // Undo is offered only for the last turn and only when no revert is staged or
  // in flight: the stage already rewrites files, so the confirmation comes first.
  const [undoRequest, setUndoRequest] = React.useState<UndoRequest | null>(null);
  const revertStaged = data.revert !== null;
  const undoBoundary = data.turnDiff?.from ?? null;
  const undoAvailable =
    undoBoundary !== null && !data.busy && !revertStaged && !data.revertPending;

  // The dialog belongs to the turn it was opened for: a new turn, another
  // session or a revert transition closes it instead of retargeting it.
  React.useEffect(() => {
    setUndoRequest(null);
  }, [data.session?.id, undoBoundary, data.busy, revertStaged, data.revertPending]);

  const requestUndo = () => {
    const turn = data.turnDiff;
    if (!undoAvailable || !turn) {
      ui.showToast(data.busy ? 'Stop the turn first' : 'There is no turn to undo');
      return;
    }
    setUndoRequest({
      from: turn.from,
      files: turn.files,
      additions: turn.additions,
      deletions: turn.deletions,
    });
  };
  const confirmUndo = () => {
    setUndoRequest(null);
    post({ type: 'undoTurn', sessionID: data.session?.id });
  };
  const sendBlocked = data.revertPending
    ? 'Wait for the current revert to finish'
    : data.revert
      ? 'Keep or undo the revert first'
      : undefined;

  const copyMessage = (message: UiMessage) => {
    const text = messageText(message);
    if (text.length === 0) {
      return;
    }
    post({ type: 'copy', text });
    ui.showToast('Copied');
  };
  // The host writes the clipboard itself and reports through the status bar.
  const copyConversation = () => post({ type: 'copyTranscript' });

  return (
    <div className="app" id="app">
      <ChatHeader
        tabs={data.tabs}
        activeId={data.session?.id ?? null}
        connected={data.connected}
        folders={data.folders}
        activeDirectory={data.activeDirectory}
        renaming={ui.rename}
        onSelectFolder={(directory) => post({ type: 'selectFolder', directory })}
        onActivate={activateTab}
        onClose={closeTab}
        onContextMenu={ui.openTabMenu}
        onNew={actions.newSession}
        onHistory={ui.openHistory}
        onSettings={ui.openSettings}
        onMenu={ui.openMenu}
        onRenameDraft={ui.setRenameDraft}
        onRenameCommit={commitRename}
        onRenameCancel={ui.cancelRename}
      />

      <Conversation
        connected={data.connected}
        error={data.error}
        sessionId={data.session?.id}
        messages={data.messages}
        history={data.history}
        notices={data.notices}
        turnDiff={data.turnDiff}
        revert={data.revert}
        revertPending={data.revertPending}
        permissions={data.permissions}
        permissionSending={data.permissionSending}
        undoRequest={undoRequest}
        models={data.models}
        settings={data.settings}
        busy={data.busy}
        toggleState={session.toggles}
        onToggle={(id, fallback) =>
          session.setToggles((previous) => ({
            ...previous,
            [id]: !(previous[id] ?? fallback),
          }))
        }
        stickToBottom={session.stickToBottom}
        distanceFromBottom={session.distanceFromBottom}
        onScrollChange={session.setScroll}
        onLoadOlder={() => post({ type: 'loadOlder' })}
        onCopy={(text) => {
          post({ type: 'copy', text });
          ui.showToast('Copied');
        }}
        onCopyMessage={copyMessage}
        onMessageMenu={ui.openMessageMenu}
        onOpenExternal={(url) => post({ type: 'openExternal', url })}
        onOpenPath={(target) => post({ type: 'openPath', ...target })}
        onSuggestion={actions.applySuggestion}
        onRetry={actions.retry}
        onReviewTurn={(from) =>
          post({ type: 'reviewTurn', sessionID: data.session?.id, from })
        }
        onUndoTurn={requestUndo}
        onConfirmUndo={confirmUndo}
        onCancelUndo={() => setUndoRequest(null)}
        onKeepRevert={() => post({ type: 'keepRevert', sessionID: data.session?.id })}
        onCancelRevert={() => post({ type: 'cancelRevert', sessionID: data.session?.id })}
        onPermissionReply={(request, decision, message) =>
          // The request owns its session: the visible one may have changed
          // while the card was on screen.
          post({
            type: 'permissionReply',
            sessionID: request.sessionID,
            requestID: request.id,
            decision,
            message,
          })
        }
      />

      <QueueStrip
        items={data.queue}
        pending={data.queuePending}
        onSteer={(id) => post({ type: 'queueSteer', id })}
        onEdit={(id) => post({ type: 'queueEdit', id })}
        onCancel={(id) => post({ type: 'queueCancel', id })}
      />

      <Composer
        draft={session.draft}
        busy={data.busy}
        sendBlocked={sendBlocked}
        settings={data.settings}
        sessionId={data.session?.id}
        caret={session.caret}
        selectionEnd={session.selectionEnd}
        attachments={attachments.items}
        attachMenuOpen={ui.popover?.kind === 'attach'}
        atLimit={attachments.atLimit}
        usage={data.usage}
        inputRef={inputRef}
        composerRef={composerRef}
        modelLabel={modelLabel}
        effortLabel={effortLabel}
        modeLabel={modeLabel}
        modelIsDefault={!data.model}
        effortIsDefault={!data.model?.variant}
        modeIsDefault={!data.agent}
        queueCount={data.queue.length}
        queuePending={data.queuePending}
        onDraftChange={(value) => {
          palette.changeDraft(value);
          const element = inputRef.current;
          if (element) {
            session.setCaret(element.selectionStart ?? value.length, element.selectionEnd ?? value.length);
          }
        }}
        onKeyDown={actions.onComposerKeyDown}
        onCaretChange={() => {
          palette.syncCaret();
          const element = inputRef.current;
          if (element) {
            session.setCaret(element.selectionStart ?? 0, element.selectionEnd ?? 0);
          }
        }}
        onPasteFiles={(files) => void attachments.attachBlobs(files)}
        onDropFiles={(files) => void attachments.attachBlobs(files)}
        onDropRejected={(message) => ui.showToast(message)}
        onAttachMenu={ui.openAttach}
        onAttachText={(text) => attachments.attachBlobs([pastedTextFile(text)])}
        onRemoveAttachment={attachments.remove}
        onSend={actions.send}
        onStop={actions.stop}
        onPickModel={openModel}
        onPickEffort={openEffort}
        onPickMode={openMode}
        onCompact={() => post({ type: 'compact' })}
        paletteOpen={palette.palette !== null}
      />

      {ui.historyOpen ? (
        <SessionHistory
          sessions={data.sessions}
          current={data.session}
          query={ui.historyQuery}
          onQuery={ui.setHistoryQuery}
          onOpen={actions.openSession}
          onDelete={actions.deleteSession}
          onNew={actions.newSession}
          onClose={ui.closeHistory}
        />
      ) : null}

      {ui.settingsOpen ? (
        <SettingsDrawer
          settings={data.settings}
          models={data.models}
          agents={data.agents}
          defaults={data.defaults}
          savedPermissions={data.savedPermissions}
          savedPermissionsError={data.savedPermissionsError}
          savedPermissionsHint={data.savedPermissionsHint}
          onUpdate={actions.updateSetting}
          onReset={actions.resetSettings}
          onOpenVscode={() => post({ type: 'openVscodeSettings' })}
          onRefreshSavedPermissions={() => post({ type: 'loadSavedPermissions' })}
          onDeleteSavedPermission={(id) => post({ type: 'deleteSavedPermission', id })}
          onClose={() => ui.setSettingsOpen(false)}
        />
      ) : null}

      {ui.popover?.kind === 'menu' ? (
        <AppMenu
          anchor={ui.popover.anchor}
          onClose={() => ui.setPopover(null)}
          onNew={actions.newSession}
          onHistory={ui.openHistory}
          onSettings={ui.openSettings}
          onModel={() => openModel(chipAnchor('model'))}
          onEffort={() => openEffort(chipAnchor('effort'))}
          onMode={() => openMode(chipAnchor('mode'))}
          onReload={actions.retry}
          onBrowser={() => post({ type: 'openBrowser' })}
          onTerminal={() => post({ type: 'openTerminal' })}
        />
      ) : null}

      {ui.popover?.kind === 'model' ? (
        <ModelPicker
          anchor={ui.popover.anchor}
          models={data.models}
          current={data.model ?? undefined}
          defaults={data.defaults}
          onSelect={actions.pickModel}
          onClose={() => ui.setPopover(null)}
        />
      ) : null}

      {ui.popover?.kind === 'effort' ? (
        <EffortPicker
          anchor={ui.popover.anchor}
          model={actions.effectiveModelEntry}
          selected={data.model?.variant}
          defaultEffort={data.defaults.effort}
          onSelect={actions.pickEffort}
          onClose={() => ui.setPopover(null)}
        />
      ) : null}

      {ui.popover?.kind === 'mode' ? (
        <ModePicker
          anchor={ui.popover.anchor}
          agents={data.agents}
          current={effectiveAgentId}
          defaultMode={data.defaults.mode}
          onSelect={(agent) => actions.pickMode(agent.id)}
          onClose={() => ui.setPopover(null)}
        />
      ) : null}

      {ui.popover?.kind === 'attach' ? (
        <AttachMenu
          anchor={ui.popover.anchor}
          onPick={pickAttachment}
          onClose={() => ui.setPopover(null)}
        />
      ) : null}

      {tabPopover ? (
        <TabMenu
          anchor={tabPopover.anchor}
          title={menuTab?.title ?? 'session'}
          pinned={menuTab?.pinned === true}
          available={menuTab !== undefined && !menuTab.missing}
          onClose={() => ui.setPopover(null)}
          onRename={() => {
            if (menuTab) {
              ui.startRename(menuTab);
            }
          }}
          onTogglePin={() => {
            if (menuTab) {
              pinTab(menuTab.id, !menuTab.pinned);
            }
          }}
          onArchive={() => {
            if (menuTab) {
              archiveTab(menuTab.id);
            }
          }}
          onFork={() => {
            if (menuTab) {
              forkTab(menuTab.id);
            }
          }}
          onOpenInEditor={() => {
            if (menuTab) {
              openInEditor(menuTab.id);
            }
          }}
          onCopyId={() => {
            if (menuTab) {
              copyId(menuTab.id);
            }
          }}
          onDelete={() => {
            if (menuTab) {
              deleteTab(menuTab.id);
            }
          }}
        />
      ) : null}

      {messagePopover ? (
        <MessageMenu
          anchor={messagePopover.anchor}
          hasText={menuMessage !== undefined && messageText(menuMessage).length > 0}
          undoAvailable={
            undoAvailable && menuMessage !== undefined && menuMessage.id === undoBoundary
          }
          onClose={() => ui.setPopover(null)}
          onCopyMessage={() => {
            if (menuMessage) {
              copyMessage(menuMessage);
            }
          }}
          onCopyConversation={copyConversation}
          onUndoTurn={requestUndo}
        />
      ) : null}

      {palette.palette ? (
        <ComposerPalette
          anchor={composerRef.current}
          kind={palette.palette.kind}
          items={palette.paletteItems}
          active={palette.activeIndex}
          onActive={palette.setActiveIndex}
          onAccept={palette.acceptPalette}
          onClose={palette.closePalette}
        />
      ) : null}

      {ui.toast ? <div className="toast">{ui.toast}</div> : null}
    </div>
  );
}



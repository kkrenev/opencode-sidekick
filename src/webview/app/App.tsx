import * as React from 'react';
import { chipAnchor } from './model/chipAnchor';
import { useChatActions } from './model/useChatActions';
import { useComposerPalette } from './model/useComposerPalette';
import { useLocalActions } from './model/useLocalActions';
import { useSidekickData } from './model/useSidekickData';
import { useSidekickUi } from './model/useSidekickUi';
import { agentName, effectiveAgent } from '../entities/agent/lib/agent';
import { effortText, modelName } from '../entities/model/lib/model';
import { AppMenu } from '../features/app-menu/ui/AppMenu';
import { ComposerPalette } from '../features/composer-palette/ui/ComposerPalette';
import { EffortPicker } from '../features/effort-picker/ui/EffortPicker';
import { ModePicker } from '../features/mode-picker/ui/ModePicker';
import { ModelPicker } from '../features/model-picker/ui/ModelPicker';
import { ChatHeader } from '../widgets/chat-header/ui/ChatHeader';
import { Composer } from '../widgets/composer/ui/Composer';
import { Conversation } from '../widgets/conversation/ui/Conversation';
import { SessionHistory } from '../widgets/session-history/ui/SessionHistory';
import { SettingsDrawer } from '../widgets/settings-drawer/ui/SettingsDrawer';
import { post } from '../shared/api/vscode';

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
  const runLocalAction = useLocalActions({ data, ui });
  const palette = useComposerPalette({
    data,
    draft: ui.draft,
    setDraft: ui.setDraft,
    inputRef,
    dismissPopover: () => ui.setPopover(null),
    onLocalAction: runLocalAction,
  });
  const actions = useChatActions({
    data,
    setData,
    ui,
    palette,
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

  return (
    <div className="app" id="app">
      <ChatHeader
        title={data.session ? data.session.title : 'New session'}
        connected={data.connected}
        onNew={actions.newSession}
        onHistory={ui.openHistory}
        onSettings={ui.openSettings}
        onMenu={ui.openMenu}
      />

      <Conversation
        connected={data.connected}
        error={data.error}
        sessionId={data.session?.id}
        messages={data.messages}
        models={data.models}
        settings={data.settings}
        busy={data.busy}
        toggleState={ui.toggles}
        onToggle={(id, fallback) =>
          ui.setToggles((previous) => ({
            ...previous,
            [id]: !(previous[id] ?? fallback),
          }))
        }
        onCopy={(text) => {
          post({ type: 'copy', text });
          ui.showToast('Copied');
        }}
        onOpenExternal={(url) => post({ type: 'openExternal', url })}
        onSuggestion={actions.applySuggestion}
        onRetry={actions.retry}
      />

      <Composer
        draft={ui.draft}
        busy={data.busy}
        settings={data.settings}
        inputRef={inputRef}
        composerRef={composerRef}
        modelLabel={modelLabel}
        effortLabel={effortLabel}
        modeLabel={modeLabel}
        modelIsDefault={!data.model}
        effortIsDefault={!data.model?.variant}
        modeIsDefault={!data.agent}
        onDraftChange={palette.changeDraft}
        onKeyDown={actions.onComposerKeyDown}
        onCaretChange={palette.syncCaret}
        onSend={actions.send}
        onStop={actions.stop}
        onPickModel={openModel}
        onPickEffort={openEffort}
        onPickMode={openMode}
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
          onUpdate={actions.updateSetting}
          onReset={actions.resetSettings}
          onOpenVscode={() => post({ type: 'openVscodeSettings' })}
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



const vscode = acquireVsCodeApi();

const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="4.5" width="18.5" height="12" rx="3.2"/><path d="M7.75 16.5v3.6l4.3-3.6"/><path d="M8.7 8.9 11.2 11l-2.5 2.1"/><path d="M13.4 13.1h2.9"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4.2V8l2.6 1.6"/><circle cx="8" cy="8" r="5.4"/></svg>',
  dots: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.6" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.4" cy="8" r="1.1"/></svg>',
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9M4.4 7.1 8 3.5l3.6 3.6"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="5" width="6" height="6" rx="1.2"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5h9M6.5 5V3.6h3V5M5 5l.5 7.5h5L11 5"/></svg>',
  terminal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2"/><path d="m5.2 6.6 2 1.6-2 1.6M8.8 10h2.2"/></svg>',
  external: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5H12.5V6.5M12.2 3.8 7.8 8.2"/><path d="M11.5 9.6v2.2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2.2"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 7.2a4.7 4.7 0 1 1-1.4-3.3"/><path d="M12.9 2.8v2.6h-2.6"/></svg>',
  model: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.4 13 5v6L8 13.6 3 11V5z"/><path d="M8 8.2v5.4M8 8.2 13 5M8 8.2 3 5"/></svg>',
  agent: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.4" width="10" height="7" rx="2.2"/><path d="M8 3v2.4M6 8.6v.8M10 8.6v.8"/></svg>',
  shell: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m4.4 5.4 2.6 2.6-2.6 2.6M9 10.6h2.8"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.6h5l3 3v7.8H4z"/><path d="M9 2.6v3h3"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="7.2" cy="7.2" r="4"/><path d="m10.2 10.2 2.4 2.4"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.6 8.4 2.8 2.8 6-6"/></svg>',
  alert: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 5.2v3.6M8 11.2v.2"/><circle cx="8" cy="8" r="5.6"/></svg>',
};

const SUGGESTIONS = [
  'Explain what this codebase does',
  'Find and fix a failing test',
  'Review my uncommitted changes',
  'Write tests for a module',
];

let state = {
  connected: false,
  error: null,
  directory: '',
  workspace: '',
  session: null,
  sessions: [],
  messages: [],
  models: [],
  agents: [],
  busy: false,
  model: null,
  agent: null,
};

const ui = {
  history: false,
  menu: false,
  popover: null,
  openIds: new Set(),
  query: '',
  draft: '',
};

const app = document.getElementById('app');
let scrollEl = null;
let threadEl = null;
let inputEl = null;
let lastMessageCount = 0;

function post(message) {
  vscode.postMessage(message);
}

function boot() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <span class="mark">${ICONS.logo}</span>
        <button class="session-pill" data-act="history">
          <span class="label"></span>
          ${ICONS.chevron}
        </button>
      </div>
      <div class="top-actions">
        <button class="icon-btn" data-act="new" title="New session">${ICONS.plus}</button>
        <button class="icon-btn" data-act="history" title="Session history">${ICONS.history}</button>
        <button class="icon-btn" data-act="menu" title="More">${ICONS.dots}</button>
      </div>
    </div>
    <div class="scroll" id="scroll"><div class="thread" id="thread"></div></div>
    <div class="composer-wrap">
      <div class="composer" id="composer">
        <textarea id="input" rows="1" placeholder="Ask OpenCode anything about this workspace"></textarea>
        <div class="composer-foot">
          <button class="chip" data-act="model" title="Model">${ICONS.model}<span class="chip-text" id="model-chip">Model</span></button>
          <button class="chip" data-act="agent" title="Agent">${ICONS.agent}<span class="chip-text" id="agent-chip">Agent</span></button>
          <span class="grow"></span>
          <button class="send" id="send" data-act="send" title="Send">${ICONS.send}</button>
        </div>
      </div>
      <div class="hint">
        <span><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
        <span id="status"></span>
      </div>
    </div>
    <div class="drawer" id="drawer" hidden></div>
    <div class="popover" id="popover" hidden></div>
    <div class="toast" id="toast" hidden></div>
  `;

  scrollEl = document.getElementById('scroll');
  threadEl = document.getElementById('thread');
  inputEl = document.getElementById('input');

  app.addEventListener('click', onAppClick);
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onInputKeydown);
  inputEl.addEventListener('paste', onPaste);
  inputEl.addEventListener('focus', () => document.getElementById('composer').classList.add('focused'));
  inputEl.addEventListener('blur', () => document.getElementById('composer').classList.remove('focused'));

  post({ type: 'ready' });
}

function onAppClick(event) {
  const action = event.target.closest('[data-act]');
  if (!action) {
    if (!event.target.closest('.popover') && ui.popover) {
      closePopover();
    }
    return;
  }

  const act = action.dataset.act;
  switch (act) {
    case 'new':
      closeMenu();
      post({ type: 'newSession' });
      break;
    case 'history':
      closeMenu();
      openHistory();
      break;
    case 'menu':
      toggleMenu(action);
      break;
    case 'send':
      submit();
      break;
    case 'stop':
      post({ type: 'stop' });
      break;
    case 'model':
      toggleModelPicker(action);
      break;
    case 'agent':
      toggleAgentPicker(action);
      break;
    case 'copy':
      post({ type: 'copy', text: action.dataset.text || '' });
      flash(action, 'Copied');
      break;
    case 'external': {
      event.preventDefault();
      post({ type: 'openExternal', url: action.dataset.url || '' });
      break;
    }
    case 'open-session':
      post({ type: 'openSession', id: action.dataset.id });
      break;
    case 'delete-session':
      event.stopPropagation();
      post({ type: 'deleteSession', id: action.dataset.id });
      break;
    case 'close-drawer':
      closeHistory();
      break;
    case 'suggestion':
      inputEl.value = action.dataset.text || '';
      onInput();
      inputEl.focus();
      break;
    case 'retry':
      post({ type: 'refresh' });
      break;
    case 'open-browser':
      closeMenu();
      post({ type: 'openBrowser' });
      break;
    case 'menu-reload':
      closeMenu();
      post({ type: 'refresh' });
      break;
    case 'menu-terminal':
      closeMenu();
      post({ type: 'openTerminal' });
      break;
    default:
      break;
  }
}

function onInput() {
  ui.draft = inputEl.value;
  autoGrow();
  updateSendButton();
}

function onInputKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === 'Escape') {
    if (ui.popover) {
      closePopover();
    } else if (ui.history) {
      closeHistory();
    } else if (ui.menu) {
      closeMenu();
    }
  }
}

function onPaste(event) {
  const data = event.clipboardData;
  if (!data) {
    return;
  }
  const text = data.getData('text/plain');
  if (text.length === 0) {
    return;
  }
  event.preventDefault();
  insertAtCursor(inputEl, text);
  onInput();
}

function insertAtCursor(element, text) {
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? element.value.length;
  element.value = element.value.slice(0, start) + text + element.value.slice(end);
  const caret = start + text.length;
  element.selectionStart = caret;
  element.selectionEnd = caret;
}

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 168)}px`;
}

function submit() {
  const text = inputEl.value.trim();
  if (text.length === 0) {
    return;
  }
  inputEl.value = '';
  ui.draft = '';
  autoGrow();
  updateSendButton();

  state.messages = state.messages.concat([
    {
      id: `local-${Date.now()}`,
      role: 'user',
      time: Date.now(),
      parts: [{ kind: 'text', text }],
    },
  ]);
  state.busy = true;
  renderThread(true);
  post({ type: 'send', text });
}

function render() {
  renderHeader();
  renderThread(false);
  renderStatus();
  if (ui.history) {
    renderHistory();
  }
}

function renderHeader() {
  const label = app.querySelector('.session-pill .label');
  if (label) {
    label.textContent = state.session ? state.session.title : 'New session';
  }

  const modelChip = document.getElementById('model-chip');
  if (modelChip) {
    const model = state.model;
    modelChip.textContent = model ? shortModel(model.id) : 'Default model';
  }

  const agentChip = document.getElementById('agent-chip');
  if (agentChip) {
    agentChip.textContent = state.agent ? capitalize(state.agent) : 'Agent';
  }
}

function renderStatus() {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = state.busy ? 'Working' : '';
  }
  updateSendButton();
}

function updateSendButton() {
  const button = document.getElementById('send');
  if (!button) {
    return;
  }
  const hasText = inputEl.value.trim().length > 0;
  if (state.busy) {
    button.classList.add('stop');
    button.innerHTML = ICONS.stop;
    button.title = 'Stop';
    button.disabled = false;
    button.dataset.act = 'stop';
  } else {
    button.classList.remove('stop');
    button.innerHTML = ICONS.send;
    button.title = 'Send';
    button.disabled = !hasText;
    button.dataset.act = 'send';
  }
}

function renderThread(forceScroll) {
  if (!state.connected) {
    renderOffline();
    return;
  }

  const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 90;
  const fragment = document.createDocumentFragment();

  if (state.messages.length === 0) {
    fragment.appendChild(buildEmpty());
  } else {
    for (const message of state.messages) {
      fragment.appendChild(buildMessage(message));
    }
    if (state.busy) {
      const working = document.createElement('div');
      working.className = 'working';
      working.innerHTML = '<span></span><span></span><span></span>';
      fragment.appendChild(working);
    }
  }

  threadEl.replaceChildren(fragment);
  renderHeader();

  if (forceScroll || nearBottom) {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
}

function renderOffline() {
  threadEl.replaceChildren();
  const box = document.createElement('div');
  box.className = 'offline';
  box.innerHTML = `
    <strong>OpenCode is not reachable</strong>
    <div>${escapeHtml(state.error || 'Start the OpenCode server and try again.')}</div>
    <button data-act="retry">Retry</button>
  `;
  threadEl.appendChild(box);
}

function buildEmpty() {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const suggestions = SUGGESTIONS.map(
    (text) => `<button class="suggestion" data-act="suggestion" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`,
  ).join('');
  wrap.innerHTML = `
    <div class="empty-mark">${ICONS.logo}</div>
    <h2>What should we build?</h2>
    <p>OpenCode is docked next to your code. Pick a starting point or just start typing.</p>
    <div class="suggestions">${suggestions}</div>
  `;
  return wrap;
}

function buildMessage(message) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${message.role}`;
  wrap.dataset.msg = message.id;

  if (message.role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = message.parts.map((part) => part.text || '').join('\n');
    wrap.appendChild(bubble);
    return wrap;
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<span class="dot"></span><span>${escapeHtml(labelFor(message))}</span>`;
  wrap.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'body';
  const streaming = state.busy && message === state.messages[state.messages.length - 1];

  message.parts.forEach((part, index) => {
    const partId = `${message.id}:${index}`;
    if (part.kind === 'text') {
      body.appendChild(buildText(part, message, partId, streaming && index === message.parts.length - 1));
      return;
    }
    if (part.kind === 'reasoning') {
      body.appendChild(buildReasoning(part, partId, streaming ? message.id : ''));
      return;
    }
    body.appendChild(buildTool(part, partId));
  });

  wrap.appendChild(body);
  return wrap;
}

function buildText(part, message, partId, isLive) {
  if (isLive) {
    const node = document.createElement('div');
    node.className = 'prose streaming';
    node.dataset.streamText = message.id;
    node.dataset.part = partId;
    node.style.whiteSpace = 'pre-wrap';
    node.textContent = part.text;
    return node;
  }

  const node = document.createElement('div');
  node.className = 'prose';
  node.innerHTML = renderMarkdown(part.text);
  return node;
}

function buildReasoning(part, partId, streamId) {
  const wrap = document.createElement('div');
  const open = ui.openIds.has(partId);
  const label = part.ms > 0 ? `Thought · ${(part.ms / 1000).toFixed(1)}s` : 'Thought';

  const button = document.createElement('button');
  button.className = `thought${open ? ' open' : ''}`;
  button.dataset.act = 'toggle';
  button.dataset.id = partId;
  button.innerHTML = `<span class="chev">${ICONS.chevron}</span><span>${escapeHtml(label)}</span>`;
  button.addEventListener('click', () => {
    if (ui.openIds.has(partId)) {
      ui.openIds.delete(partId);
    } else {
      ui.openIds.add(partId);
    }
    renderThread(false);
  });

  const body = document.createElement('div');
  body.className = 'thought-body';
  if (streamId) {
    body.dataset.streamThought = streamId;
  }
  body.hidden = !open;
  body.textContent = part.text;

  wrap.appendChild(button);
  wrap.appendChild(body);
  return wrap;
}

function buildTool(part, partId) {
  const wrap = document.createElement('div');
  wrap.className = 'tool';
  wrap.dataset.status = part.status;

  const head = document.createElement('button');
  head.className = 'tool-head';
  const status =
    part.status === 'running'
      ? '<span class="spinner"></span>'
      : part.status === 'ok'
        ? ICONS.check
        : ICONS.alert;
  head.innerHTML = `
    <span class="tool-glyph">${glyphFor(part.name)}</span>
    <span class="tool-name">${escapeHtml(part.name)}</span>
    <span class="tool-title">${escapeHtml(part.title)}</span>
    <span class="tool-state">${status}</span>
  `;

  const body = document.createElement('div');
  body.className = 'tool-body';
  body.hidden = !ui.openIds.has(partId);
  const sections = [];
  if (part.input.length > 0) {
    sections.push(`<div><div class="tool-label">Input</div><pre>${escapeHtml(clip(part.input))}</pre></div>`);
  }
  if (part.output.length > 0) {
    sections.push(`<div><div class="tool-label">Output</div><pre>${escapeHtml(clip(part.output))}</pre></div>`);
  }
  body.innerHTML = sections.join('') || '<div class="tool-label">No details</div>';

  head.addEventListener('click', () => {
    if (ui.openIds.has(partId)) {
      ui.openIds.delete(partId);
    } else {
      ui.openIds.add(partId);
    }
    renderThread(false);
  });

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function glyphFor(name) {
  if (name === 'shell' || name === 'bash' || name === 'terminal') {
    return ICONS.shell;
  }
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'patch') {
    return ICONS.file;
  }
  if (name === 'grep' || name === 'glob' || name === 'find') {
    return ICONS.search;
  }
  return ICONS.model;
}

function labelFor(message) {
  const agent = message.agent ? capitalize(message.agent) : 'OpenCode';
  const model = message.model ? ` · ${shortModel(message.model)}` : '';
  return `${agent}${model}`;
}

function applyDelta(messageID, kind, delta) {
  let target = state.messages.find((message) => message.id === messageID);

  if (!target) {
    target = {
      id: messageID,
      role: 'assistant',
      time: Date.now(),
      agent: state.agent || undefined,
      parts: [{ kind: kind === 'text' ? 'text' : 'reasoning', text: '' }],
    };
    state.messages = state.messages.concat([target]);
    renderThread(true);
  }

  const wanted = kind === 'text' ? 'text' : 'reasoning';
  let part = [...target.parts].reverse().find((entry) => entry.kind === wanted);
  if (!part) {
    part = wanted === 'text' ? { kind: 'text', text: '' } : { kind: 'reasoning', text: '', ms: 0 };
    target.parts = target.parts.concat([part]);
    renderThread(false);
  }
  part.text += delta;

  const selector =
    kind === 'text' ? `[data-stream-text="${messageID}"]` : `[data-stream-thought="${messageID}"]`;
  const node = threadEl.querySelector(selector);
  if (node) {
    node.textContent = part.text;
    if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 90) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }
}

function toggleMenu(anchor) {
  if (ui.menu) {
    closeMenu();
    return;
  }
  closePopover();
  const rect = anchor.getBoundingClientRect();
  const popover = document.getElementById('popover');
  popover.innerHTML = `
    <div class="popover-list">
      <button class="row" data-act="new"><span class="row-main"><span class="row-title">New session</span></span></button>
      <button class="row" data-act="menu-reload"><span class="row-main"><span class="row-title">Reload panel</span></span></button>
      <button class="row" data-act="open-browser"><span class="row-main"><span class="row-title">Open in browser</span></span></button>
      <button class="row" data-act="menu-terminal"><span class="row-main"><span class="row-title">Open in terminal</span></span></button>
    </div>
  `;
  popover.hidden = false;
  popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  ui.menu = true;
  ui.popover = 'menu';
}

function toggleModelPicker(anchor) {
  if (ui.popover === 'model') {
    closePopover();
    return;
  }
  if (state.models.length === 0) {
    toast('No models reported by the server yet.');
    return;
  }
  const current = state.model;
  const items = state.models
    .map((model) => {
      const active = current && model.id === current.id && model.providerID === current.providerID;
      return `<button class="row${active ? ' active' : ''}" data-act="pick-model" data-id="${escapeHtml(model.id)}" data-provider="${escapeHtml(model.providerID)}">
        <span class="row-main"><span class="row-title">${escapeHtml(model.name)}</span><span class="row-sub">${escapeHtml(model.providerID)}</span></span>
      </button>`;
    })
    .join('');
  showPopover(anchor, 'Model', items);
  ui.popover = 'model';
}

function toggleAgentPicker(anchor) {
  if (ui.popover === 'agent') {
    closePopover();
    return;
  }
  if (state.agents.length === 0) {
    toast('No agents reported by the server yet.');
    return;
  }
  const items = state.agents
    .map((agent) => {
      const active = state.agent === agent.id;
      return `<button class="row${active ? ' active' : ''}" data-act="pick-agent" data-id="${escapeHtml(agent.id)}">
        <span class="row-main"><span class="row-title">${escapeHtml(agent.name)}</span></span>
      </button>`;
    })
    .join('');
  showPopover(anchor, 'Agent', items);
  ui.popover = 'agent';
}

function showPopover(anchor, title, items) {
  closeMenu();
  const popover = document.getElementById('popover');
  const rect = anchor.getBoundingClientRect();
  popover.innerHTML = `<div class="popover-title">${escapeHtml(title)}</div><div class="popover-list">${items}</div>`;
  popover.hidden = false;
  popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  popover.addEventListener('click', onPopoverClick);
}

function onPopoverClick(event) {
  const row = event.target.closest('[data-act]');
  if (!row) {
    return;
  }
  if (row.dataset.act === 'pick-model') {
    post({
      type: 'selectModel',
      selection: { id: row.dataset.id, providerID: row.dataset.provider },
    });
    closePopover();
  }
  if (row.dataset.act === 'pick-agent') {
    post({ type: 'selectAgent', agent: row.dataset.id });
    closePopover();
  }
}

function closePopover() {
  const popover = document.getElementById('popover');
  if (!popover) {
    return;
  }
  popover.hidden = true;
  popover.removeEventListener('click', onPopoverClick);
  ui.popover = null;
}

function closeMenu() {
  if (ui.popover === 'menu') {
    closePopover();
  }
  ui.menu = false;
}

function openHistory() {
  ui.history = true;
  renderHistory();
  post({ type: 'searchSessions', query: ui.query });
}

function closeHistory() {
  ui.history = false;
  if (ui.query.length > 0) {
    ui.query = '';
    post({ type: 'searchSessions', query: '' });
  }
  const drawer = document.getElementById('drawer');
  if (drawer) {
    drawer.hidden = true;
    drawer.innerHTML = '';
  }
}

function renderHistory() {
  const drawer = document.getElementById('drawer');
  if (!drawer) {
    return;
  }
  drawer.hidden = false;
  const groups = groupSessions(state.sessions);
  const rows = groups
    .map((group) => {
      const items = group.items
        .map((session) => {
          const active = state.session && session.id === state.session.id;
          return `<button class="row${active ? ' active' : ''}" data-act="open-session" data-id="${escapeHtml(session.id)}">
            <span class="row-main">
              <span class="row-title">${escapeHtml(session.title)}</span>
              <span class="row-sub">${session.running ? '<span class="live"></span>' : ''}${escapeHtml(relativeTime(session.updated))}</span>
            </span>
            <span class="delete" data-act="delete-session" data-id="${escapeHtml(session.id)}" title="Delete">${ICONS.trash}</span>
          </button>`;
        })
        .join('');
      return `<div class="group-label">${escapeHtml(group.label)}</div>${items}`;
    })
    .join('');

  const previous = drawer.querySelector('#session-search');
  const caret = previous ? previous.selectionStart : 0;
  drawer.innerHTML = `
    <div class="drawer-top">
      <span class="drawer-title">Sessions</span>
      <button class="icon-btn" data-act="new" title="New session">${ICONS.plus}</button>
      <button class="icon-btn" data-act="close-drawer" title="Close">${ICONS.close}</button>
    </div>
    <div class="search"><input id="session-search" type="text" placeholder="Search sessions" value="${escapeHtml(ui.query)}" /></div>
    <div class="drawer-list">${rows || '<div class="group-label">No sessions yet</div>'}</div>
  `;

  const search = drawer.querySelector('#session-search');
  search.addEventListener('input', () => {
    ui.query = search.value;
    clearTimeout(renderHistory.timer);
    renderHistory.timer = setTimeout(() => post({ type: 'searchSessions', query: ui.query }), 220);
  });
  if (previous) {
    search.focus();
    search.selectionStart = caret;
    search.selectionEnd = caret;
  }
}

function groupSessions(sessions) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = [
    { label: 'Today', after: startOfToday, items: [] },
    { label: 'Yesterday', after: startOfToday - 86400000, items: [] },
    { label: 'Previous 7 days', after: startOfToday - 7 * 86400000, items: [] },
    { label: 'Older', after: 0, items: [] },
  ];

  for (const session of sessions) {
    const bucket = buckets.find((entry) => session.updated >= entry.after);
    (bucket || buckets[buckets.length - 1]).items.push(session);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}

function relativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

function renderMarkdown(source) {
  const codeBlocks = [];
  let text = source.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (_match, lang, body) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', body: body.replace(/\n$/, '') });
    return `\u0000CODE${index}\u0000`;
  });

  text = escapeHtml(text);

  const lines = text.split('\n');
  const out = [];
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const placeholder = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (placeholder) {
      closeList();
      const block = codeBlocks[Number(placeholder[1])];
      out.push(codeBlockHtml(block.lang, block.body));
      continue;
    }
    if (line.trim().length === 0) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(ordered[2])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();

  return out.join('');
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="#" data-act="external" data-url="$2">$1</a>');
}

function codeBlockHtml(lang, body) {
  const encoded = escapeHtml(body);
  return `<div class="code"><div class="code-head"><span class="code-lang">${escapeHtml(lang)}</span><button class="copy-btn" data-act="copy" data-text="${escapeHtml(body)}">Copy</button></div><pre><code>${encoded}</code></pre></div>`;
}

function toast(message) {
  const node = document.getElementById('toast');
  if (!node) {
    return;
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 4200);
}

function flash(button, label) {
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function shortModel(id) {
  if (!id) {
    return 'Model';
  }
  return id.replace(/^@[^/]+\//, '').replace(/-/g, ' ');
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function clip(text) {
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'state': {
      const previousSession = state.session ? state.session.id : '';
      state = { ...state, ...message.state };
      const nextSession = state.session ? state.session.id : '';
      if (inputEl && previousSession !== nextSession) {
        inputEl.value = '';
        ui.draft = '';
        autoGrow();
      }
      render();
      if (ui.history) {
        renderHistory();
      }
      break;
    }
    case 'messages':
      state.messages = message.messages;
      renderThread(false);
      break;
    case 'sessions':
      state.sessions = message.sessions;
      if (message.session) {
        state.session = message.session;
      }
      renderHeader();
      if (ui.history) {
        renderHistory();
      }
      break;
    case 'busy':
      state.busy = message.busy;
      renderThread(false);
      renderStatus();
      break;
    case 'delta':
      applyDelta(message.messageID, message.kind, message.delta);
      break;
    case 'error':
      toast(message.message);
      break;
    case 'focus':
      if (inputEl) {
        inputEl.focus();
      }
      break;
    case 'openHistory':
      openHistory();
      break;
    case 'closeHistory':
      closeHistory();
      break;
    default:
      break;
  }
});

boot();

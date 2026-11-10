export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clip(text: string, max = 6000): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export function capitalize(value: string | undefined): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

export function shortModel(id: string | undefined): string {
  if (!id) {
    return 'Model';
  }
  return id.replace(/^@[^/]+\//, '').replace(/-/g, ' ');
}

export function clockTime(timestamp: number): string {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sendHint(sendKey: 'enter' | 'mod-enter'): string {
  return sendKey === 'enter'
    ? 'Enter send · Shift+Enter new line'
    : 'Cmd/Ctrl+Enter send · Enter new line';
}

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

/** `1.4k` / `1.4M`, and `—` for a value that is not known yet. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const rounded = Math.max(0, value);
  if (rounded < 1000) {
    return String(Math.round(rounded));
  }
  if (rounded < 1_000_000) {
    return `${trimDecimal(rounded / 1000)}k`;
  }
  return `${trimDecimal(rounded / 1_000_000)}M`;
}

/** `$0.0123`; an empty string when the session cost is still zero. */
export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined || !Number.isFinite(cost) || cost <= 0) {
    return '';
  }
  return `$${cost.toFixed(4)}`;
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

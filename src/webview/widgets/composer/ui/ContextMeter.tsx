import * as React from 'react';
import { formatCost, formatTokens } from '../../../shared/lib/format';
import type { SessionUsage } from '../../../shared/types/snapshot';

/**
 * Context usage chip in the composer foot. The percentage needs a reported
 * model limit; without one only the token count is shown and auto-compaction
 * stays off.
 */
export function ContextMeter({
  usage,
  busy,
  blocked,
  onCompact,
}: {
  usage: SessionUsage;
  busy: boolean;
  /** Why Compact is unavailable right now, shown as the button tooltip. */
  blocked?: string;
  onCompact: () => void;
}): React.ReactElement | null {
  const visible =
    usage.compacting ||
    usage.used !== null ||
    usage.compacted ||
    usage.lastCompaction !== undefined;
  if (!visible) {
    return null;
  }
  const percent = usage.percent;
  const label = usage.compacting
    ? 'Compacting…'
    : usage.used === null
      ? '—'
      : percent !== undefined
        ? `${percent}%`
        : `${formatTokens(usage.used)} tokens`;
  const description = usage.compacting
    ? 'Compacting context'
    : usage.used === null
      ? 'Context usage unknown'
      : percent !== undefined
        ? `${percent}% of context used`
        : `${formatTokens(usage.used)} tokens in context`;
  const showCompact = !usage.compacting && (usage.level === 'warn' || usage.level === 'compact');

  return (
    <>
      <div
        className={`context-meter level-${usage.level}${usage.compacting ? ' compacting' : ''}`}
        role="status"
        aria-label={description}
        title={tooltip(usage)}
      >
        {percent !== undefined ? (
          <span className="context-meter-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </span>
        ) : null}
        <span className="context-meter-text">{label}</span>
      </div>
      {showCompact ? (
        <button
          className="banner-btn compact-btn"
          type="button"
          data-act="compact"
          title={blocked ?? 'Compact the conversation context'}
          disabled={busy || blocked !== undefined}
          onClick={onCompact}
        >
          Compact
        </button>
      ) : null}
    </>
  );
}

function tooltip(usage: SessionUsage): string {
  const lines: string[] = [];
  if (usage.used !== null) {
    lines.push(
      usage.limit !== undefined
        ? `Context: ${formatTokens(usage.used)} / ${formatTokens(usage.limit)} tokens${
            usage.percent !== undefined ? ` (${usage.percent}%)` : ''
          }`
        : `Context: ${formatTokens(usage.used)} tokens`,
    );
  }
  if (usage.tokens) {
    const cache = usage.tokens.cacheRead + usage.tokens.cacheWrite;
    lines.push(
      `In ${formatTokens(usage.tokens.input)} · Out ${formatTokens(usage.tokens.output)} · Cache ${formatTokens(cache)}`,
    );
  }
  const cost = formatCost(usage.cost);
  if (cost.length > 0) {
    lines.push(`Session cost ${cost}`);
  }
  if (usage.lastCompaction) {
    lines.push(
      `Last compaction: ${usage.lastCompaction.reason === 'auto' ? 'automatic' : 'manual'}`,
    );
  }
  if (usage.used === null && usage.compacted) {
    lines.push('Usage is measured again after the next turn');
  }
  return lines.length > 0 ? lines.join('\n') : 'Context usage';
}

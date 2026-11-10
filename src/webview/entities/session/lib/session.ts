import type { SessionSummary } from '../../../shared/types/domain';

export function groupSessions(
  sessions: readonly SessionSummary[],
): { label: string; items: SessionSummary[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = [
    { label: 'Today', after: startOfToday, items: [] as SessionSummary[] },
    { label: 'Yesterday', after: startOfToday - 86400000, items: [] as SessionSummary[] },
    { label: 'Previous 7 days', after: startOfToday - 7 * 86400000, items: [] as SessionSummary[] },
    { label: 'Older', after: 0, items: [] as SessionSummary[] },
  ];

  for (const session of sessions) {
    const bucket = buckets.find((entry) => session.updated >= entry.after);
    (bucket || buckets[buckets.length - 1]).items.push(session);
  }

  return buckets.filter((bucket) => bucket.items.length > 0);
}

export function relativeTime(timestamp: number): string {
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

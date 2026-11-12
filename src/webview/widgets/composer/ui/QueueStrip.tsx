import * as React from 'react';
import { canEditQueueItem, queueSummary, type QueueItem } from '../../../../shared/inbox';
import { clockTime } from '../../../shared/lib/format';
import { Icon } from '../../../shared/ui/Icon';

/** Chip label of an inbox row; a queued user prompt reads as its delivery. */
function kindLabel(item: QueueItem): string {
  switch (item.type) {
    case 'user':
      return item.delivery === 'steer' ? 'Steering' : 'Queue';
    case 'synthetic':
      return 'Synthetic';
    case 'compaction':
      return 'Compacting';
    case 'move':
      return 'Move';
  }
}

/** One line the row shows; the full text stays in the title. */
function rowText(item: QueueItem): string {
  switch (item.type) {
    case 'user':
      return item.text && item.text.length > 0 ? item.text : 'Empty prompt';
    case 'synthetic':
      return item.description ?? item.text ?? 'Synthetic message';
    case 'compaction':
      return 'Compact the context';
    case 'move':
      return 'Move to another folder';
  }
}

/**
 * The server inbox of the visible session, pinned above the composer. Rows are
 * mirrors of the server list: a delivered item disappears on its frame, not on
 * the click, so a failed action falls back to a re-read.
 */
export function QueueStrip({
  items,
  pending,
  onSteer,
  onEdit,
  onCancel,
}: {
  items: readonly QueueItem[];
  pending: readonly string[];
  onSteer: (id: string) => void;
  onEdit: (id: string) => void;
  onCancel: (id: string) => void;
}): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }
  const summary = queueSummary(items);
  return (
    <div className="queue-strip" aria-label="Queued messages">
      <div className="queue-strip-head">
        <span className="queue-strip-title">
          {summary.count} in queue
        </span>
      </div>
      <ul className="queue-list">
        {summary.visible.map((item) => {
          const busy = pending.includes(item.id);
          const user = item.type === 'user';
          const editable = canEditQueueItem(item);
          const text = rowText(item);
          const time = clockTime(item.created);
          return (
            <li className="queue-row" key={item.id} data-queue-id={item.id}>
              <span
                className={`queue-kind ${item.type}${
                  item.type === 'user' && item.delivery === 'steer' ? ' steering' : ''
                }`}
              >
                {kindLabel(item)}
              </span>
              <span className="queue-text" title={text}>
                {text}
              </span>
              {time.length > 0 ? <span className="queue-time">{time}</span> : null}
              <span className="queue-actions">
                {user ? (
                  <button
                    className="queue-btn"
                    type="button"
                    data-act="queue-steer"
                    title={busy ? 'Working…' : 'Send now'}
                    aria-label="Send now"
                    disabled={busy}
                    onClick={() => onSteer(item.id)}
                  >
                    <Icon name="send" />
                  </button>
                ) : null}
                {user ? (
                  <button
                    className="queue-btn"
                    type="button"
                    data-act="queue-edit"
                    title={editable ? 'Edit in the composer' : 'Nothing to edit'}
                    aria-label={editable ? 'Edit' : 'Nothing to edit'}
                    disabled={busy || !editable}
                    onClick={() => onEdit(item.id)}
                  >
                    <Icon name="rename" />
                  </button>
                ) : null}
                <button
                  className="queue-btn"
                  type="button"
                  data-act="queue-cancel"
                  title="Delete from the queue"
                  aria-label="Delete"
                  disabled={busy}
                  onClick={() => onCancel(item.id)}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {summary.hidden > 0 ? (
        <div className="queue-more">+{summary.hidden} more</div>
      ) : null}
    </div>
  );
}

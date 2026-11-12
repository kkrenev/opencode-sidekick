import * as React from 'react';
import { Icon, type IconName } from '../../../shared/ui/Icon';
import type { PendingAttachment } from '../../../shared/types/domain';
import { formatAttachmentSize } from '../lib/attachments';

const KIND_ICON: Record<PendingAttachment['kind'], IconName> = {
  image: 'image',
  file: 'file',
  folder: 'folder',
  selection: 'cursor',
  problems: 'alert',
};

const KIND_LABEL: Record<PendingAttachment['kind'], string> = {
  image: 'image',
  file: 'file',
  folder: 'folder',
  selection: 'selection',
  problems: 'problems',
};

export function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: readonly PendingAttachment[];
  onRemove: (id: string) => void;
}): React.ReactElement | null {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attach-tray" id="attach-tray">
      {attachments.map((attachment) => {
        const detail =
          attachment.size > 0
            ? formatAttachmentSize(attachment.size)
            : attachment.description || KIND_LABEL[attachment.kind];
        const problems = attachment.context?.problems;
        const label = attachment.auto
          ? 'active file'
          : attachment.kind === 'problems' && problems !== undefined
            ? `${problems} ${problems === 1 ? 'problem' : 'problems'}`
            : `${KIND_LABEL[attachment.kind]} · ${detail}`;
        return (
          <div
            key={attachment.id}
            className={`attach-chip${attachment.previewUri ? ' has-thumb' : ''}`}
            data-attach-id={attachment.id}
            data-auto={attachment.auto ? 'true' : undefined}
            title={attachment.description ? `${attachment.name}\n${attachment.description}` : attachment.name}
          >
            {attachment.previewUri ? (
              <img
                className="attach-thumb"
                src={attachment.previewUri}
                alt={attachment.name}
                draggable={false}
              />
            ) : (
              <span className="attach-glyph">
                <Icon name={KIND_ICON[attachment.kind]} />
              </span>
            )}
            <span className="attach-text">
              <span className="attach-name">{attachment.name}</span>
              <span className="attach-size">{label}</span>
            </span>
            <button
              className="attach-remove"
              type="button"
              data-act="remove-attachment"
              data-attach-id={attachment.id}
              aria-label={`Remove ${attachment.name}`}
              title={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

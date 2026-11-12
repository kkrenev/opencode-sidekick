import * as React from 'react';
import { createPortal } from 'react-dom';
import { openTargetFor } from '../../../../shared/open-target';
import { useImagePreview } from '../../../shared/lib/imagePreview';
import { requestThreadMeasure } from '../../../shared/lib/threadMeasure';
import type { OpenPathTarget, UiAttachment } from '../../../shared/types/ui';
import { Icon } from '../../../shared/ui/Icon';

/**
 * One attachment of the transcript. An image shows its preview and opens a
 * lightbox on click; anything the webview cannot render falls back to a file
 * chip with the same Open action, so the layout never breaks on a missing file.
 */
export function AttachmentView({
  attachment,
  onOpenPath,
}: {
  attachment: UiAttachment;
  onOpenPath: (target: OpenPathTarget) => void;
}): React.ReactElement {
  if (attachment.kind === 'image') {
    return <ImageAttachment attachment={attachment} onOpenPath={onOpenPath} />;
  }
  return <FileChip attachment={attachment} onOpenPath={onOpenPath} />;
}

function ImageAttachment({
  attachment,
  onOpenPath,
}: {
  attachment: UiAttachment;
  onOpenPath: (target: OpenPathTarget) => void;
}): React.ReactElement {
  const preview = useImagePreview(attachment.uri);
  const [zoom, setZoom] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  // An inline `data:` image has no file on disk, so the lightbox offers no
  // dead "Open in editor" button; only the file preview and the chip can open.
  const target = openTargetFor(attachment);

  const close = () => {
    setZoom(false);
    triggerRef.current?.focus();
  };

  if (attachment.tooLarge) {
    return <FileChip attachment={attachment} note="Too large to preview" onOpenPath={onOpenPath} />;
  }
  if (preview.failed) {
    return <FileChip attachment={attachment} note="Preview unavailable" onOpenPath={onOpenPath} />;
  }

  return (
    <div className="part-image">
      <button
        ref={triggerRef}
        className="part-image-button"
        type="button"
        data-act="preview-image"
        aria-label={`Preview ${attachment.name}`}
        title={attachment.name}
        onClick={() => setZoom(true)}
      >
        {preview.src ? (
          <img
            src={preview.src}
            alt={attachment.name}
            loading="lazy"
            draggable={false}
            onLoad={requestThreadMeasure}
          />
        ) : (
          <span className="part-image-pending" aria-hidden="true" />
        )}
      </button>
      {zoom && preview.src ? (
        <Lightbox
          name={attachment.name}
          src={preview.src}
          onClose={close}
          onOpen={
            target
              ? () => {
                  close();
                  onOpenPath(target);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function FileChip({
  attachment,
  note,
  onOpenPath,
}: {
  attachment: UiAttachment;
  note?: string;
  onOpenPath: (target: OpenPathTarget) => void;
}): React.ReactElement {
  const target = openTargetFor(attachment);
  const path = attachment.path ?? attachment.name;
  const detail = attachment.line !== undefined ? `${path}:${attachment.line}` : path;
  return (
    <div className="file-chip" title={note ? `${attachment.name}\n${note}` : attachment.name}>
      <span className="file-chip-glyph">
        <Icon name={attachment.kind === 'image' ? 'image' : 'file'} />
      </span>
      <span className="file-chip-text">
        <span className="file-chip-name">{attachment.name}</span>
        {detail !== attachment.name || note ? (
          <span className="file-chip-path">
            {detail}
            {note ? ` · ${note}` : ''}
          </span>
        ) : null}
      </span>
      {target ? (
        <button
          className="file-chip-open"
          type="button"
          data-act="open-path"
          aria-label={`Open ${attachment.name}`}
          title={`Open ${detail}`}
          onClick={() => onOpenPath(target)}
        >
          Open
        </button>
      ) : null}
    </div>
  );
}

function Lightbox({
  name,
  src,
  onClose,
  onOpen,
}: {
  name: string;
  src: string;
  onClose: () => void;
  /** Absent for an inline image: there is no file the editor could open. */
  onOpen?: () => void;
}): React.ReactElement {
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // The thread scrolls and clips, so the dialog lives on `body` instead.
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} preview`}>
      <div className="lightbox-backdrop" onClick={onClose} />
      <div className="lightbox-body">
        <img className="lightbox-image" src={src} alt={name} draggable={false} />
        <div className="lightbox-bar">
          <span className="lightbox-name">{name}</span>
          {onOpen ? (
            <button className="lightbox-open" type="button" onClick={onOpen}>
              Open in editor
            </button>
          ) : null}
          <button
            ref={closeRef}
            className="lightbox-close"
            type="button"
            aria-label="Close preview"
            title="Close preview"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

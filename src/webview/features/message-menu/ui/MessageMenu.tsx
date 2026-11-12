import * as React from 'react';
import { MenuRow } from '../../../shared/ui/MenuRow';
import { Popover, type PopoverAnchor } from '../../../shared/ui/Popover';

/**
 * Right-click menu of one message. Copying the whole conversation lives here
 * too, so the transcript export is reachable without the command palette.
 */
export function MessageMenu({
  anchor,
  hasText,
  undoAvailable,
  onClose,
  onCopyMessage,
  onCopyConversation,
  onUndoTurn,
}: {
  anchor: PopoverAnchor | null;
  /** False for a message with only tool or reasoning parts. */
  hasText: boolean;
  /** This message starts the last turn, so that turn can be undone. */
  undoAvailable: boolean;
  onClose: () => void;
  onCopyMessage: () => void;
  onCopyConversation: () => void;
  onUndoTurn: () => void;
}): React.ReactElement {
  return (
    <Popover anchor={anchor} align="menu" onClose={onClose} className="menu-popover message-menu">
      <div className="popover-list">
        <div className="popover-group">Message</div>
        <MenuRow
          icon="copy"
          label="Copy message"
          title={hasText ? 'Copy the message text' : 'This message has no text'}
          disabled={!hasText}
          onClick={() => {
            onClose();
            onCopyMessage();
          }}
        />
        {undoAvailable ? (
          <MenuRow
            icon="undo"
            label="Undo turn"
            title="Restore the files to the state before this turn"
            onClick={() => {
              onClose();
              onUndoTurn();
            }}
          />
        ) : null}
        <MenuRow
          icon="history"
          label="Copy conversation"
          title="Copy the whole conversation as markdown"
          onClick={() => {
            onClose();
            onCopyConversation();
          }}
        />
      </div>
    </Popover>
  );
}

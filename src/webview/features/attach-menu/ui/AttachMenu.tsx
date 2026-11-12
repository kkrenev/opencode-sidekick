import * as React from 'react';
import { Icon, type IconName } from '../../../shared/ui/Icon';
import { Popover } from '../../../shared/ui/Popover';
import type { AttachAction } from '../lib/attachments';

const MENU: readonly {
  readonly action: AttachAction;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
}[] = [
  { action: 'file', label: 'File', description: 'Pick one or more files', icon: 'file' },
  { action: 'folder', label: 'Folder', description: 'Attach a whole folder', icon: 'folder' },
  {
    action: 'selection',
    label: 'Selection',
    description: 'Attach the text selected in the editor',
    icon: 'cursor',
  },
  {
    action: 'screenshot',
    label: 'Screenshot',
    description: 'Capture a region (paste from clipboard on Windows/Linux)',
    icon: 'image',
  },
  {
    action: 'problems',
    label: 'Problems',
    description: 'Attach diagnostics of the active file',
    icon: 'alert',
  },
];

export function AttachMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  onPick: (action: AttachAction) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Popover anchor={anchor} align="menu" className="attach-popover" onClose={onClose}>
      <div className="popover-title">Attach</div>
      <div className="popover-list">
        {MENU.map((item) => (
          <button
            key={item.action}
            className="row"
            type="button"
            data-act={`attach-${item.action}`}
            onClick={() => onPick(item.action)}
          >
            <span className="row-glyph">
              <Icon name={item.icon} />
            </span>
            <span className="row-main">
              <span className="row-title">{item.label}</span>
              <span className="row-sub">{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

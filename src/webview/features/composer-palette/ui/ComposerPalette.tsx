import * as React from 'react';
import { Icon } from '../../../shared/ui/Icon';
import { Popover } from '../../../shared/ui/Popover';
import type { PaletteItem, PaletteKind } from '../lib/palette';

export function ComposerPalette({
  anchor,
  kind,
  items,
  active,
  onActive,
  onAccept,
  onClose,
}: {
  anchor: HTMLElement | null;
  kind: PaletteKind;
  items: readonly PaletteItem[];
  active: number;
  onActive: (index: number) => void;
  onAccept: (index: number) => void;
  onClose: () => void;
}): React.ReactElement {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`.palette-row[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Popover anchor={anchor} onClose={onClose} className="palette-popover">
      <div className="popover-title">{kind === 'slash' ? 'Commands' : 'Files and skills'}</div>
      <div className="popover-list" id="popover-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="popover-empty">No matches</div>
        ) : (
          items.map((item, index) => (
            <button
              key={`${item.kind}:${item.id}`}
              className={`row palette-row${index === active ? ' active' : ''}`}
              type="button"
              data-act="pick-palette"
              data-index={index}
              onMouseEnter={() => onActive(index)}
              onClick={() => onAccept(index)}
            >
              <span className="row-glyph">
                <Icon
                  name={
                    item.kind === 'file'
                      ? 'file'
                      : item.kind === 'skill'
                        ? 'skill'
                        : 'command'
                  }
                />
              </span>
              <span className="row-main">
                <span className="row-title">{item.label}</span>
                {item.description ? <span className="row-sub">{item.description}</span> : null}
              </span>
              <span className="row-kind">{item.kind}</span>
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}

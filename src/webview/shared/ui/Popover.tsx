import * as React from 'react';

interface PopoverPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
}

export function Popover({
  anchor,
  align = 'full',
  className,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  align?: 'full' | 'menu';
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = React.useState<PopoverPosition>({ maxHeight: 360 });

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !anchor) {
      return;
    }

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const below = spaceBelow >= 200 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(160, Math.min(420, below ? spaceBelow : spaceAbove));

      if (align === 'menu') {
        const width = Math.min(280, viewportWidth - margin * 2);
        const popoverHeight = Math.min(maxHeight, element.scrollHeight || maxHeight);
        const left = Math.max(
          margin,
          Math.min(rect.right - width, viewportWidth - width - margin),
        );
        if (below) {
          setPosition({
            top: rect.bottom + margin,
            bottom: undefined,
            left,
            right: undefined,
            maxHeight,
          });
        } else {
          setPosition({
            top: Math.max(margin, rect.top - margin - popoverHeight),
            bottom: undefined,
            left,
            right: undefined,
            maxHeight,
          });
        }
        return;
      }

      if (below) {
        setPosition({
          top: rect.bottom + margin,
          bottom: undefined,
          left: margin,
          right: margin,
          maxHeight,
        });
      } else {
        setPosition({
          top: undefined,
          bottom: viewportHeight - rect.top + margin,
          left: margin,
          right: margin,
          maxHeight,
        });
      }
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (ref.current?.contains(target)) {
        return;
      }
      if (anchor?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      id="popover"
      className={`popover${align === 'menu' ? ' popover-menu' : ''}${className ? ` ${className}` : ''}`}
      style={{
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        right: position.right,
        maxHeight: position.maxHeight,
      }}
      role="dialog"
    >
      {children}
    </div>
  );
}

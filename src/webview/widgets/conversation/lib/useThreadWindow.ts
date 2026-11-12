import * as React from 'react';
import { subscribeThreadMeasure } from '../../../shared/lib/threadMeasure';
import {
  buildGeometry,
  rangePads,
  THREAD_ESTIMATE,
  THREAD_OVERSCAN,
  visibleRange,
  type ThreadRange,
} from './thread-window';

const MIN_ESTIMATE = 32;
const MEASURE_EPSILON = 0.5;

export interface ThreadAnchor {
  readonly id: string;
  readonly top: number;
}

export interface ThreadWindow {
  readonly range: ThreadRange;
  readonly top: number;
  readonly bottom: number;
  readonly scrollTop: number;
  readonly version: number;
}

export function useThreadWindow({
  ids,
  scrollRef,
  enabled,
  bottomOffset,
  anchor,
}: {
  ids: readonly string[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  enabled: boolean;
  bottomOffset?: number | null;
  anchor?: ThreadAnchor | null;
}): ThreadWindow {
  const heightsRef = React.useRef<Map<string, number>>(new Map());
  const estimateRef = React.useRef(THREAD_ESTIMATE);
  const gapRef = React.useRef(0);
  const [estimate, setEstimate] = React.useState(THREAD_ESTIMATE);
  const [version, setVersion] = React.useState(0);
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 });
  // An image that finishes loading grows its item outside a React render; the
  // forced render below lets the layout effect record the new height.
  const [, setMeasureTick] = React.useState(0);
  React.useEffect(
    () => subscribeThreadMeasure(() => setMeasureTick((value) => value + 1)),
    [],
  );

  const geometry = React.useMemo(
    () => buildGeometry(ids, heightsRef.current, estimate),
    [ids, estimate, version],
  );
  const index = React.useMemo(() => {
    const positions = new Map<string, number>();
    ids.forEach((id, position) => positions.set(id, position));
    return positions;
  }, [ids]);

  const anchoredIndex = anchor ? index.get(anchor.id) : undefined;
  const scrollTop =
    bottomOffset !== null && bottomOffset !== undefined
      ? Math.max(0, geometry.total - viewport.height - bottomOffset)
      : anchor && anchoredIndex !== undefined
        ? Math.max(0, geometry.offsets[anchoredIndex] + gapRef.current - anchor.top)
        : viewport.scrollTop;

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = { scrollTop: element.scrollTop, height: element.clientHeight };
      setViewport((previous) =>
        previous.scrollTop === next.scrollTop && previous.height === next.height
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(sync);
      }
    };
    sync();
    element.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      element.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [scrollRef]);

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const items = element.querySelectorAll<HTMLElement>('[data-thread-id]');
    if (items.length === 0) {
      return;
    }
    const gap = marginTop(items[0]);
    gapRef.current = gap;
    let changed = false;
    let fresh = 0;
    items.forEach((item) => {
      const id = item.dataset.threadId;
      if (!id) {
        return;
      }
      const height = item.offsetHeight + gap;
      if (height <= 0) {
        return;
      }
      const previous = heightsRef.current.get(id);
      if (previous === undefined) {
        fresh += 1;
      }
      if (previous === undefined || Math.abs(previous - height) > MEASURE_EPSILON) {
        heightsRef.current.set(id, height);
        changed = true;
      }
    });
    if (fresh > 0) {
      let total = 0;
      let count = 0;
      for (const height of heightsRef.current.values()) {
        total += height;
        count += 1;
      }
      const next = Math.max(MIN_ESTIMATE, total / count);
      if (Math.abs(next - estimateRef.current) > MEASURE_EPSILON) {
        estimateRef.current = next;
        setEstimate(next);
      }
    }
    if (changed) {
      setVersion((value) => value + 1);
    }
  });

  const windowed = React.useMemo(() => {
    if (!enabled) {
      return { range: { start: 0, end: ids.length }, top: 0, bottom: 0 };
    }
    const range = visibleRange(geometry, scrollTop, viewport.height, THREAD_OVERSCAN);
    const pads = rangePads(geometry, range.start, range.end);
    return { range, top: pads.top, bottom: pads.bottom };
  }, [enabled, geometry, scrollTop, viewport.height, ids.length]);

  return {
    range: windowed.range,
    top: windowed.top,
    bottom: windowed.bottom,
    scrollTop,
    version,
  };
}

function marginTop(element: HTMLElement | undefined): number {
  if (!element) {
    return 0;
  }
  const value = Number.parseFloat(window.getComputedStyle(element).marginTop);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

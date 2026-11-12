export const THREAD_OVERSCAN = 8;
export const THREAD_ESTIMATE = 96;
export const THREAD_WINDOW_THRESHOLD = 60;

export interface ThreadGeometry {
  readonly offsets: number[];
  readonly total: number;
}

export interface ThreadRange {
  readonly start: number;
  readonly end: number;
}

export interface ThreadPads {
  readonly top: number;
  readonly bottom: number;
}

export function buildGeometry(
  ids: readonly string[],
  heights: ReadonlyMap<string, number>,
  estimate: number,
): ThreadGeometry {
  const offsets = new Array<number>(ids.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const measured = heights.get(ids[index]);
    const height = measured !== undefined && measured > 0 ? measured : estimate;
    offsets[index + 1] = offsets[index] + height;
  }
  return { offsets, total: offsets[ids.length] };
}

export function visibleRange(
  geometry: ThreadGeometry,
  scrollTop: number,
  viewport: number,
  overscan: number = THREAD_OVERSCAN,
): ThreadRange {
  const count = geometry.offsets.length - 1;
  if (count === 0) {
    return { start: 0, end: 0 };
  }
  const top = Math.max(0, scrollTop);
  const limit = top + Math.max(0, viewport);
  const firstVisible = firstIndexAbove(geometry.offsets, top, count);
  const firstBelow = firstIndexAtOrAfter(geometry.offsets, limit, count);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, Math.max(start, firstBelow + overscan));
  return { start, end };
}

export function rangePads(geometry: ThreadGeometry, start: number, end: number): ThreadPads {
  return {
    top: geometry.offsets[start],
    bottom: geometry.total - geometry.offsets[end],
  };
}

function firstIndexAbove(offsets: readonly number[], value: number, count: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] > value) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function firstIndexAtOrAfter(offsets: readonly number[], value: number, count: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] >= value) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

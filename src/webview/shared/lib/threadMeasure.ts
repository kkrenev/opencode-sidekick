/**
 * A height change that happens after a render (an image finishes loading) is
 * invisible to React, so the virtualized thread keeps a stale geometry and the
 * scroll jumps. A growing element asks for a measure; the thread re-renders and
 * its layout effect records the new height.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Called by a component whose box grew outside a React render. */
export function requestThreadMeasure(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeThreadMeasure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

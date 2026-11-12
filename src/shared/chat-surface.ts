/** Where a chat surface lives: the secondary sidebar or an editor tab. */
export type SurfaceKind = 'sidebar' | 'editor';

/** Lifecycle of one chat surface, from `created` to `ready`. */
export interface SurfaceState {
  readonly id: string;
  readonly kind: SurfaceKind;
  /** The webview finished booting and can receive frames. */
  ready: boolean;
}

/**
 * Bookkeeping of the chat surfaces of one provider. It never owns a webview:
 * the host keeps delivery, because request-scoped frames go to one surface and
 * a `previewUri` is minted per webview.
 */
export class SurfaceRegistry<T extends SurfaceState> {
  private readonly entries = new Map<string, T>();
  private activeID: string | undefined;

  add(surface: T): void {
    this.entries.set(surface.id, surface);
  }

  remove(id: string): T | undefined {
    const removed = this.entries.get(id);
    this.entries.delete(id);
    if (this.activeID === id) {
      this.activeID = undefined;
    }
    return removed;
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  /** Idempotent: a webview that reloads sends `ready` again. */
  markReady(id: string): void {
    const surface = this.entries.get(id);
    if (surface) {
      surface.ready = true;
    }
  }

  /** A booting surface can be touched; `active()` filters it out until ready. */
  markActive(id: string): void {
    if (this.entries.has(id)) {
      this.activeID = id;
    }
  }

  /** Every surface a broadcast can reach. */
  ready(): T[] {
    return [...this.entries.values()].filter((surface) => surface.ready);
  }

  hasReady(): boolean {
    return this.ready().length > 0;
  }

  /**
   * The surface UI-only frames go to: the last one the user touched, else the
   * sidebar, else the first ready one. Never a surface that is still booting,
   * so `active()` is either `undefined` or a ready surface.
   */
  active(): T | undefined {
    const candidates = this.ready();
    const active =
      this.activeID === undefined
        ? undefined
        : candidates.find((surface) => surface.id === this.activeID);
    if (active) {
      return active;
    }
    const sidebar = candidates.find((surface) => surface.kind === 'sidebar');
    return sidebar ?? candidates[0];
  }
}

/** Where a host frame goes: both surfaces, the active one, or the asker only. */
export type FrameScope = 'broadcast' | 'active' | 'initiator';

/**
 * Routing table of the chat protocol, shared by the host and its checks.
 *
 * - `broadcast`: both surfaces render the same chat, so they must see the same
 *   frame; a command that focuses the sidebar cannot lose the frame because the
 *   panel was touched last.
 * - `active`: a frame that changes what one user is looking at right now (the
 *   composer focus, a toast) belongs to the surface they last interacted with.
 * - `initiator`: a frame that answers one request (attachments, an image
 *   preview, a rejected or accepted send, a file or session search, a queue
 *   edit) must never reach another surface, where the request id means nothing,
 *   the `previewUri` belongs to another webview and the draft would change.
 */
export function frameScope(frame: { type?: unknown; requestId?: unknown }): FrameScope {
  const type = typeof frame.type === 'string' ? frame.type : '';
  const requestScoped = typeof frame.requestId === 'string' && frame.requestId.length > 0;
  switch (type) {
    case 'attached':
      // The host hands an attachment to every surface; an `attached` with a
      // request id is the answer to one picker.
      return requestScoped ? 'initiator' : 'broadcast';
    case 'attachError':
    case 'attachDone':
    case 'sendAccepted':
    case 'sendRejected':
    case 'files':
    case 'imagePreview':
    case 'queueEdit':
      return 'initiator';
    case 'focus':
    case 'toast':
      return 'active';
    case 'sessions':
      // A stream push lists sessions for every surface; a search answer is
      // only for the drawer that asked.
      return requestScoped ? 'initiator' : 'broadcast';
    default:
      return 'broadcast';
  }
}

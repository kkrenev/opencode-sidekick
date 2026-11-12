/**
 * The webview bundle talks to the host through `acquireVsCodeApi()`, which only
 * exists inside a real webview. The stub is installed before any test imports a
 * module that calls it, and it records what the panel posted so a test can
 * assert on the message instead of on a mock call.
 */
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export interface HostStub {
  /** Messages the webview sent to the host, in order. */
  readonly posted: unknown[];
  /** Panel state the webview stored with `setState`. */
  readonly state: { current: unknown };
}

export const host: HostStub = {
  posted: [],
  state: { current: undefined },
};

export function installHostStub(): void {
  (globalThis as unknown as { acquireVsCodeApi: () => VsCodeApi }).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => {
      host.posted.push(message);
    },
    getState: () => host.state.current,
    setState: (state: unknown) => {
      host.state.current = state;
    },
  });
}

export function resetHostStub(): void {
  host.posted.length = 0;
  host.state.current = undefined;
}

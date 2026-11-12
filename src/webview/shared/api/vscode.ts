import type { IncomingMessage } from './protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

export function post(message: Record<string, unknown>): void {
  vscode.postMessage(message);
}

export function subscribeToHost<T = IncomingMessage>(
  handler: (message: T) => void,
): () => void {
  const listener = (event: MessageEvent<T>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

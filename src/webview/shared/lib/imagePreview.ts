import * as React from 'react';
import { post, subscribeToHost } from '../api/vscode';

/**
 * Image previews of the transcript. A `file:` URI cannot be put into `<img>`
 * directly: only the host can mint a webview URI, and only for the webview that
 * will show it. So the panel asks lazily, caches the answer per URI, and falls
 * back to a file chip when the host refuses or never answers.
 */

/** A missing answer must not leave a spinner in the thread forever. */
const PREVIEW_TIMEOUT_MS = 10_000;

interface PreviewFrame {
  readonly type?: string;
  readonly uri?: string;
  readonly previewUri?: string;
}

export interface ImagePreview {
  /** Webview URI to render; absent while the answer is in flight. */
  readonly src?: string;
  /** The host cannot show this file; the caller renders a chip instead. */
  readonly failed: boolean;
}

/** Answers keyed by the raw URI the transcript carries. */
const cache = new Map<string, string | null>();
const waiters = new Map<string, Set<(value: string | null) => void>>();
const timers = new Map<string, number>();
let subscribed = false;
let requestCount = 0;

export function requestPreview(uri: string): Promise<string | null> {
  const cached = cache.get(uri);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  ensureSubscribed();
  const pending = waiters.get(uri);
  if (pending) {
    return new Promise((resolve) => pending.add(resolve));
  }
  return new Promise((resolve) => {
    const listeners = new Set([resolve]);
    waiters.set(uri, listeners);
    timers.set(
      uri,
      window.setTimeout(() => settle(uri, null), PREVIEW_TIMEOUT_MS),
    );
    requestCount += 1;
    post({ type: 'imagePreview', uri, requestId: `preview-${requestCount}` });
  });
}

export function useImagePreview(uri: string | undefined): ImagePreview {
  const [state, setState] = React.useState<ImagePreview>(() => initial(uri));
  React.useEffect(() => {
    if (uri === undefined || uri.length === 0) {
      setState({ failed: true });
      return;
    }
    if (isInline(uri)) {
      setState({ src: uri, failed: false });
      return;
    }
    let active = true;
    setState({ failed: false });
    void requestPreview(uri).then((value) => {
      if (active) {
        setState(value ? { src: value, failed: false } : { failed: true });
      }
    });
    return () => {
      active = false;
    };
  }, [uri]);
  return state;
}

function initial(uri: string | undefined): ImagePreview {
  if (uri !== undefined && isInline(uri)) {
    return { src: uri, failed: false };
  }
  return { failed: false };
}

function isInline(uri: string): boolean {
  return /^data:/i.test(uri);
}

function ensureSubscribed(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;
  subscribeToHost<PreviewFrame>((frame) => {
    if (frame.type !== 'imagePreview' || typeof frame.uri !== 'string') {
      return;
    }
    const preview = typeof frame.previewUri === 'string' ? frame.previewUri : '';
    settle(frame.uri, preview.length > 0 ? preview : null);
  });
}

function settle(uri: string, value: string | null): void {
  const timer = timers.get(uri);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(uri);
  }
  cache.set(uri, value);
  const listeners = waiters.get(uri);
  waiters.delete(uri);
  if (listeners) {
    for (const listener of listeners) {
      listener(value);
    }
  }
}

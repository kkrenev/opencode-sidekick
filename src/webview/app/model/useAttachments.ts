import * as React from 'react';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  checkAttachLimit,
  readFileDataUrl,
} from '../../features/attach-menu/lib/attachments';
import { post, subscribeToHost } from '../../shared/api/vscode';
import type { PendingAttachment } from '../../shared/types/domain';

const MAX_LABEL = `${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`;
const NEW_SESSION_PREFIX = '__new__';
const NO_ATTACHMENTS: readonly PendingAttachment[] = [];
/** The host answers an attach request immediately; this only bounds a lost frame. */
const ATTACH_REPLY_TIMEOUT_MS = 15_000;
const CLIPBOARD_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

export function useAttachments({
  sessionId,
  directory,
  showToast,
}: {
  sessionId: string | null;
  /** Folder of the panel; a new chat keeps its chips per folder. */
  directory: string;
  showToast: (message: string) => void;
}) {
  const key = sessionId ?? `${NEW_SESSION_PREFIX}:${directory}`;
  const [states, setStates] = React.useState<Record<string, readonly PendingAttachment[]>>({});
  const statesRef = React.useRef(states);
  const pending = React.useRef<Map<string, string>>(new Map());
  /** Resolvers of `attachBlobs`, settled by the host `attached`/`attachError` frames. */
  const waiters = React.useRef<Map<string, (attached: boolean) => void>>(new Map());
  const sequence = React.useRef(0);

  statesRef.current = states;

  const items = states[key] ?? NO_ATTACHMENTS;

  const commit = React.useCallback((target: string, next: readonly PendingAttachment[]) => {
    statesRef.current = { ...statesRef.current, [target]: next };
    setStates(statesRef.current);
  }, []);

  const settle = React.useCallback((requestId: string | undefined, attached: boolean) => {
    if (requestId === undefined) {
      return;
    }
    // The request is answered, so a later duplicate frame must not find an
    // owner and land in the tray a second time.
    pending.current.delete(requestId);
    const resolve = waiters.current.get(requestId);
    if (!resolve) {
      return;
    }
    waiters.current.delete(requestId);
    resolve(attached);
  }, []);

  const waitForAttachment = React.useCallback((requestId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      // A missing answer must not freeze the caller that is holding pasted text.
      const timer = window.setTimeout(() => {
        if (waiters.current.delete(requestId)) {
          pending.current.delete(requestId);
          resolve(false);
        }
      }, ATTACH_REPLY_TIMEOUT_MS);
      waiters.current.set(requestId, (attached) => {
        window.clearTimeout(timer);
        resolve(attached);
      });
    });
  }, []);

  const sendRequest = React.useCallback(
    (message: Record<string, unknown>): string => {
      sequence.current += 1;
      const requestId = `attach-${sequence.current}`;
      pending.current.set(requestId, key);
      post({ ...message, requestId });
      return requestId;
    },
    [key],
  );

  React.useEffect(() => {
    const ownerOf = (requestId: string | undefined, sessionID?: string): string | undefined => {
      if (requestId !== undefined) {
        return pending.current.get(requestId);
      }
      // A host-initiated frame names its chat, so it cannot land in the wrong
      // bucket when it arrives in the same burst as the first `state` frame.
      if (typeof sessionID === 'string' && sessionID.length > 0) {
        return sessionID;
      }
      return key;
    };

    return subscribeToHost((message) => {
      if (message.type === 'autoContext') {
        // The frame names its folder too: a state update may not have reached
        // this handler yet when the panel just switched folders.
        const owner =
          typeof message.sessionID === 'string' && message.sessionID.length > 0
            ? message.sessionID
            : `${NEW_SESSION_PREFIX}:${
                typeof message.directory === 'string' ? message.directory : directory
              }`;
        const existing = statesRef.current[owner] ?? NO_ATTACHMENTS;
        const manual = existing.filter((attachment) => !attachment.auto);
        const attachment = message.autoContext;
        if (!attachment) {
          if (manual.length !== existing.length) {
            commit(owner, manual);
          }
          return;
        }
        // A manual chip with the same file wins; the auto slot never duplicates it.
        if (manual.some((entry) => entry.uri === attachment.uri)) {
          return;
        }
        // A repeated frame for the same file must not add a second auto chip.
        if (existing.some((entry) => entry.auto && entry.uri === attachment.uri)) {
          return;
        }
        const auto: PendingAttachment = {
          ...attachment,
          id: `auto:${attachment.uri}`,
          auto: true,
        };
        const verdict = checkAttachLimit(manual, auto);
        if (!verdict.ok) {
          // The auto slot never nags: a full tray just keeps the manual chips.
          return;
        }
        commit(owner, [...manual, auto]);
        return;
      }
      if (message.type === 'attachmentRemoved') {
        // The same chip was added to every surface that received the
        // attachment, so a removal in one of them clears the others too.
        const id = typeof message.id === 'string' ? message.id : '';
        const uri = typeof message.uri === 'string' ? message.uri : '';
        if (id.length === 0 && uri.length === 0) {
          return;
        }
        const next: Record<string, readonly PendingAttachment[]> = {};
        let changed = false;
        for (const [owner, entries] of Object.entries(statesRef.current)) {
          // The id is what both surfaces received; the URI is only a fallback
          // for a frame without one, because the same file can sit in another
          // chat's tray under a different id.
          const kept = entries.filter((entry) =>
            id.length > 0 ? entry.id !== id : entry.uri !== uri,
          );
          next[owner] = kept;
          if (kept.length !== entries.length) {
            changed = true;
          }
        }
        if (changed) {
          statesRef.current = next;
          setStates(next);
        }
        return;
      }
      if (message.type === 'attached') {
        const attachment = message.attachment;
        if (!attachment) {
          settle(message.requestId, false);
          return;
        }
        const owner = ownerOf(message.requestId, message.sessionID);
        if (owner === undefined) {
          settle(message.requestId, false);
          return;
        }
        const existing = statesRef.current[owner] ?? NO_ATTACHMENTS;
        const verdict = checkAttachLimit(existing, attachment);
        if (!verdict.ok) {
          if (!verdict.silent) {
            showToast(verdict.reason);
          }
          settle(message.requestId, false);
          return;
        }
        commit(owner, [...existing, attachment]);
        settle(message.requestId, true);
        return;
      }
      if (message.type === 'attachError') {
        if (ownerOf(message.requestId, message.sessionID) === undefined) {
          settle(message.requestId, false);
          return;
        }
        showToast(message.message || 'Could not attach that file.');
        settle(message.requestId, false);
        return;
      }
      if (message.type === 'attachDone') {
        if (message.requestId === undefined) {
          return;
        }
        pending.current.delete(message.requestId);
        // The host finished without an `attached` frame: nothing landed.
        settle(message.requestId, false);
      }
    });
  }, [commit, directory, key, settle, showToast]);

  const request = React.useCallback(
    (type: string) => {
      if ((statesRef.current[key] ?? NO_ATTACHMENTS).length >= MAX_ATTACHMENTS) {
        showToast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        return;
      }
      sendRequest({ type });
    },
    [key, sendRequest, showToast],
  );

  const attachFile = React.useCallback(() => request('attach:file'), [request]);
  const attachFolder = React.useCallback(() => request('attach:folder'), [request]);
  const attachSelection = React.useCallback(() => request('attach:selection'), [request]);
  const attachScreenshot = React.useCallback(() => request('attach:screenshot'), [request]);
  const attachProblems = React.useCallback(() => request('attach:problems'), [request]);

  /** Resolves with the number of attachments the host actually accepted. */
  const attachBlobs = React.useCallback(
    async (files: readonly File[]): Promise<number> => {
      let slots = MAX_ATTACHMENTS - (statesRef.current[key] ?? NO_ATTACHMENTS).length;
      if (slots <= 0) {
        showToast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        return 0;
      }
      let attached = 0;
      for (const file of files) {
        if (slots <= 0) {
          showToast(`You can attach up to ${MAX_ATTACHMENTS} files.`);
          break;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          showToast(`${file.name || 'That file'} is larger than ${MAX_LABEL}.`);
          continue;
        }
        try {
          const dataUrl = await readFileDataUrl(file);
          const image = CLIPBOARD_IMAGE_TYPES.has(file.type.toLowerCase());
          const requestId = sendRequest(
            image
              ? { type: 'attach:clipboard', dataUrl, name: file.name || 'screenshot.png' }
              : { type: 'attach:data', dataUrl, name: file.name || 'attachment' },
          );
          if (await waitForAttachment(requestId)) {
            slots -= 1;
            attached += 1;
          }
        } catch {
          showToast(`Could not read ${file.name || 'that file'}.`);
        }
      }
      return attached;
    },
    [key, sendRequest, showToast, waitForAttachment],
  );

  const remove = React.useCallback(
    (id: string) => {
      const existing = statesRef.current[key] ?? NO_ATTACHMENTS;
      const target = existing.find((attachment) => attachment.id === id);
      commit(
        key,
        existing.filter((attachment) => attachment.id !== id),
      );
      if (target?.auto) {
        // The host must not offer this file again until the editor moves.
        post({ type: 'autoContextDismiss', uri: target.uri });
        return;
      }
      // An inline selection has no stored file to delete.
      if (target && !target.uri.startsWith('data:')) {
        post({ type: 'attach:remove', id: target.id, uri: target.uri });
      }
    },
    [commit, key],
  );

  const clear = React.useCallback(() => commit(key, NO_ATTACHMENTS), [commit, key]);

  const restore = React.useCallback(
    (items: readonly PendingAttachment[]) => {
      const existing = statesRef.current[key] ?? NO_ATTACHMENTS;
      const seen = new Set(existing.map((attachment) => attachment.uri));
      const next = [...existing];
      for (const item of items) {
        if (next.length >= MAX_ATTACHMENTS) {
          break;
        }
        if (seen.has(item.uri)) {
          continue;
        }
        seen.add(item.uri);
        next.push(item);
      }
      commit(key, next);
    },
    [commit, key],
  );

  return {
    items,
    atLimit: items.length >= MAX_ATTACHMENTS,
    attachFile,
    attachFolder,
    attachSelection,
    attachScreenshot,
    attachProblems,
    attachBlobs,
    remove,
    clear,
    restore,
  };
}

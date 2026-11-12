import * as React from 'react';
import { Message } from '../../../entities/message/ui/Message';
import { PermissionCard } from '../../../features/permission-card/ui/PermissionCard';
import type { SidekickSettings } from '../../../shared/config/settings';
import { clockTime } from '../../../shared/lib/format';
import type { ModelEntry } from '../../../shared/types/domain';
import type { HistoryState, UiNotice } from '../../../shared/types/snapshot';
import type { PermissionDecision, PermissionRequest } from '../../../../shared/permission';
import type { SearchHit } from '../../../../shared/chat-search';
import type { TurnDiffSummary, TurnDiffFile } from '../../../../shared/turn-diff';
import type { OpenPathTarget, UiMessage } from '../../../shared/types/ui';
import { THREAD_WINDOW_THRESHOLD } from '../lib/thread-window';
import { useThreadWindow, type ThreadAnchor } from '../lib/useThreadWindow';
import { applyHighlights, clearHighlights } from '../lib/search-highlight';
import { ConversationEmpty } from './ConversationEmpty';
import { ConversationOffline } from './ConversationOffline';

const AT_BOTTOM_EDGE = 90;
const JUMP_EDGE = 240;
const LOAD_OLDER_EDGE = 320;
const FILL_EDGE = 320;
const MAX_RESTORE_PAGES = 5;
/** Files listed by the revert card and the confirmation; the rest is a count. */
const REVERT_FILE_LIMIT = 50;

interface Restore {
  readonly sessionId: string;
  readonly distance: number;
  readonly pages: number;
  readonly requestedAt: number;
  readonly target: number;
}

/**
 * Turn the confirmation was opened for. It is a copy, not a reference to the
 * live diff: a new turn or a staged revert must not retarget the dialog.
 */
export interface UndoRequest {
  readonly from: string;
  readonly files: readonly TurnDiffFile[];
  readonly additions: number;
  readonly deletions: number;
}

export function Conversation({
  connected,
  error,
  sessionId,
  messages,
  history,
  notices,
  turnDiff,
  revert,
  revertPending,
  permissions,
  permissionSending,
  undoRequest,
  models,
  settings,
  busy,
  toggleState,
  stickToBottom,
  distanceFromBottom,
  search,
  onToggle,
  onScrollChange,
  onLoadOlder,
  onCopy,
  onCopyMessage,
  onMessageMenu,
  onOpenExternal,
  onOpenPath,
  onSuggestion,
  onRetry,
  onReviewTurn,
  onUndoTurn,
  onConfirmUndo,
  onCancelUndo,
  onKeepRevert,
  onCancelRevert,
  onPermissionReply,
}: {
  connected: boolean;
  error: string | null;
  sessionId: string | undefined;
  messages: readonly UiMessage[];
  history: HistoryState;
  notices: readonly UiNotice[];
  turnDiff: TurnDiffSummary | null;
  revert: TurnDiffSummary | null;
  revertPending: boolean;
  /** Pending requests of the visible session, oldest first. */
  permissions: readonly PermissionRequest[];
  /** Request ids with a reply in flight. */
  permissionSending: readonly string[];
  /** The turn the confirmation belongs to; fixed when it was opened. */
  undoRequest: UndoRequest | null;
  models: readonly ModelEntry[];
  settings: SidekickSettings;
  busy: boolean;
  toggleState: Record<string, boolean>;
  stickToBottom: boolean;
  distanceFromBottom: number;
  /** Transcript search: hits, the active one and the jump trigger. */
  search: {
    readonly open: boolean;
    readonly query: string;
    readonly hits: readonly SearchHit[];
    readonly current: number;
    readonly jumpNonce: number;
  };
  onToggle: (id: string, fallback: boolean) => void;
  onScrollChange: (scrollTop: number, stickToBottom: boolean, distanceFromBottom: number) => void;
  onLoadOlder: () => void;
  onCopy: (text: string) => void;
  onCopyMessage: (message: UiMessage) => void;
  onMessageMenu: (id: string, point: { x: number; y: number }) => void;
  onOpenExternal: (url: string) => void;
  /** Opens an attachment or a tool file at its line. */
  onOpenPath: (target: OpenPathTarget) => void;
  onSuggestion: (text: string) => void;
  onRetry: () => void;
  onReviewTurn: (from: string) => void;
  /** Opens the confirmation; it never touches the files by itself. */
  onUndoTurn: () => void;
  onConfirmUndo: () => void;
  onCancelUndo: () => void;
  onKeepRevert: () => void;
  onCancelRevert: () => void;
  onPermissionReply: (
    request: PermissionRequest,
    decision: PermissionDecision,
    message?: string,
  ) => void;
}): React.ReactElement {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const threadRef = React.useRef<HTMLDivElement | null>(null);
  const ids = React.useMemo(() => messages.map((message) => message.id), [messages]);
  const [restore, setRestore] = React.useState<Restore | null>(null);
  const [showJump, setShowJump] = React.useState(false);
  const anchorRef = React.useRef<ThreadAnchor | null>(null);
  const fillRef = React.useRef(-1);
  const programmaticRef = React.useRef<number | null>(null);
  const jumpRef = React.useRef(false);
  /** A jump still has to scroll the active match itself into view. */
  const rangeJumpRef = React.useRef(false);
  const [, setJumpTick] = React.useState(0);
  const restoreRef = React.useRef<Restore | null>(restore);
  restoreRef.current = restore;

  const virtual = messages.length > THREAD_WINDOW_THRESHOLD;
  const windowed = useThreadWindow({
    ids,
    scrollRef,
    enabled: virtual,
    bottomOffset: stickToBottom && !jumpRef.current ? 0 : restore ? restore.distance : null,
    anchor: anchorRef.current,
  });

  const setScrollTop = (element: HTMLDivElement, value: number) => {
    const target = Math.max(0, value);
    if (Math.abs(element.scrollTop - target) < 0.5) {
      return;
    }
    element.scrollTop = target;
    programmaticRef.current = element.scrollTop;
  };

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    anchorRef.current = null;
    fillRef.current = -1;
    jumpRef.current = false;
    rangeJumpRef.current = false;
    if (!element) {
      return;
    }
    const distance = stickToBottom ? 0 : Math.max(0, Math.round(distanceFromBottom));
    const nextRestore = stickToBottom
      ? null
      : { sessionId: sessionId ?? '', distance, pages: 0, requestedAt: -1, target: -1 };
    restoreRef.current = nextRestore;
    setRestore(nextRestore);
    if (stickToBottom) {
      setScrollTop(element, element.scrollHeight);
    }
  }, [sessionId]);

  // Search navigation: point the virtualizer at the hit, then let the main
  // effect below align it. `setJumpTick` re-renders so `useThreadWindow` gets
  // the new anchor and renders a message outside the current window.
  React.useLayoutEffect(() => {
    const hit = search.open ? search.hits[search.current] : undefined;
    if (!hit) {
      jumpRef.current = false;
      rangeJumpRef.current = false;
      return;
    }
    // A collapsed reasoning or tool body has no DOM region yet: open it first,
    // then the highlight pass can paint and scroll to the match.
    const reveal = revealTarget(hit, messages, settings);
    if (reveal && !(toggleState[reveal.id] ?? reveal.fallback)) {
      onToggle(reveal.id, reveal.fallback);
    }
    restoreRef.current = null;
    setRestore(null);
    anchorRef.current = { id: hit.messageId, top: 8 };
    jumpRef.current = true;
    rangeJumpRef.current = true;
    setJumpTick((value) => value + 1);
  }, [search.jumpNonce]);

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    const thread = threadRef.current;
    if (!element) {
      return;
    }
    const pending = restoreRef.current;

    if (stickToBottom && !jumpRef.current) {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      if (settings.autoScroll) {
        setScrollTop(element, maxScroll);
      }
      setShowJump(false);
    } else if (pending) {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      const target = Math.max(0, Math.min(maxScroll, maxScroll - pending.distance));
      const needsMore =
        maxScroll < pending.distance &&
        history.hasMoreOlder &&
        pending.pages < MAX_RESTORE_PAGES;
      if (Math.abs(target - pending.target) > 0.5) {
        restoreRef.current = { ...pending, target };
        setRestore(restoreRef.current);
        setScrollTop(element, target);
      } else if (needsMore) {
        if (!history.loadingOlder && pending.requestedAt !== messages.length) {
          restoreRef.current = {
            ...pending,
            pages: pending.pages + 1,
            requestedAt: messages.length,
          };
          setRestore(restoreRef.current);
          onLoadOlder();
        }
      } else {
        restoreRef.current = null;
        setRestore(null);
        setScrollTop(element, target);
        const distance = Math.max(
          0,
          Math.round(element.scrollHeight - element.scrollTop - element.clientHeight),
        );
        onScrollChange(element.scrollTop, distance < AT_BOTTOM_EDGE, distance);
        setShowJump(distance < AT_BOTTOM_EDGE ? false : distance > JUMP_EDGE);
      }
    } else {
      const anchor = anchorRef.current;
      const item = anchor && thread ? findItem(thread, anchor.id) : null;
      if (anchor && item) {
        const delta =
          item.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) {
          element.scrollTop += delta;
          programmaticRef.current = element.scrollTop;
        }
        if (jumpRef.current) {
          // The scroll event of a programmatic jump is swallowed, so App would
          // keep auto-scrolling to the bottom without this explicit report. A
          // hit already near the bottom keeps following the stream.
          jumpRef.current = false;
          const distance = Math.max(
            0,
            Math.round(element.scrollHeight - element.scrollTop - element.clientHeight),
          );
          onScrollChange(element.scrollTop, distance < AT_BOTTOM_EDGE, distance);
          setShowJump(distance > JUMP_EDGE);
        }
      }
    }

    if (thread && !restoreRef.current && !jumpRef.current) {
      anchorRef.current = captureAnchor(element, thread);
    }

    if (
      !restoreRef.current &&
      history.hasMoreOlder &&
      !history.loadingOlder &&
      element.scrollHeight <= element.clientHeight + FILL_EDGE &&
      fillRef.current !== messages.length
    ) {
      fillRef.current = messages.length;
      onLoadOlder();
    }
  });

  // Runs after every commit: streaming text, the virtual window and the active
  // hit all change the DOM. Cleanup drops the registries on close and unmount.
  React.useLayoutEffect(() => {
    const active = applyHighlights(
      threadRef.current,
      search.open ? search.hits : [],
      search.current,
      search.open ? search.query : '',
    );
    // The message anchor puts the message top on screen; a long message still
    // needs the match itself scrolled into view. The scroll event is swallowed
    // by `programmaticRef`, so the new position is reported here.
    if (active && rangeJumpRef.current) {
      rangeJumpRef.current = false;
      const element = scrollRef.current;
      if (element) {
        const delta = rangeScrollDelta(element, active);
        if (Math.abs(delta) >= 1) {
          element.scrollTop += delta;
          programmaticRef.current = element.scrollTop;
          anchorRef.current = threadRef.current
            ? captureAnchor(element, threadRef.current)
            : null;
          const distance = Math.max(
            0,
            Math.round(element.scrollHeight - element.scrollTop - element.clientHeight),
          );
          // Same rule as the message alignment: a hit near the bottom keeps
          // following the stream, a hit further up stops auto-scroll.
          onScrollChange(element.scrollTop, distance < AT_BOTTOM_EDGE, distance);
          setShowJump(distance > JUMP_EDGE);
        }
      }
    }
    return clearHighlights;
  });

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const expected = programmaticRef.current;
    if (expected !== null) {
      programmaticRef.current = null;
      if (Math.abs(element.scrollTop - expected) < 1) {
        return;
      }
    }
    const thread = threadRef.current;
    const distance = Math.max(
      0,
      Math.round(element.scrollHeight - element.scrollTop - element.clientHeight),
    );
    const atBottom = distance < AT_BOTTOM_EDGE;
    jumpRef.current = false;
    rangeJumpRef.current = false;
    if (restoreRef.current) {
      setRestore(null);
    }
    anchorRef.current = thread ? captureAnchor(element, thread) : null;
    onScrollChange(element.scrollTop, atBottom, distance);
    setShowJump(!atBottom && distance > JUMP_EDGE);
    if (element.scrollTop < LOAD_OLDER_EDGE && history.hasMoreOlder && !history.loadingOlder) {
      onLoadOlder();
    }
  };

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    anchorRef.current = null;
    jumpRef.current = false;
    rangeJumpRef.current = false;
    setScrollTop(element, element.scrollHeight);
    onScrollChange(element.scrollTop, true, 0);
    setShowJump(false);
  };

  // The confirmation is the last chance to cancel before the stage rewrites
  // files, so Escape must always reach it.
  React.useEffect(() => {
    if (!undoRequest) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancelUndo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undoRequest, onCancelUndo]);

  const noticeList = notices.map((notice) => (
    <div
      className={`thread-notice${notice.kind === 'revert' ? ' revert' : ''}${
        notice.kind === 'permission' ? ' permission' : ''
      }`}
      role="status"
      key={notice.id}
      title={notice.text.length > 0 ? notice.text.slice(0, 600) : undefined}
    >
      {noticeText(notice)}
      {notice.at > 0 ? ` · ${clockTime(notice.at)}` : ''}
    </div>
  ));

  return (
    <div className="conversation">
      <div className="scroll" id="scroll" ref={scrollRef} onScroll={onScroll}>
        <div
          className={virtual ? 'thread virtual' : 'thread'}
          id="thread"
          ref={threadRef}
          style={{ paddingTop: windowed.top, paddingBottom: Math.max(24, windowed.bottom) }}
        >
          {!connected ? (
            <ConversationOffline error={error} onRetry={onRetry} />
          ) : (
            <>
              {messages.length === 0 ? (
                <ConversationEmpty onSuggestion={onSuggestion} />
              ) : null}
              {messages
                .slice(windowed.range.start, windowed.range.end)
                .map((message, index) => (
                  <div className="thread-item" data-thread-id={message.id} key={message.id}>
                    <Message
                      message={message}
                      models={models}
                      settings={settings}
                      busy={busy}
                      isLast={windowed.range.start + index === messages.length - 1}
                      toggleState={toggleState}
                      onToggle={onToggle}
                      onCopy={onCopy}
                      onCopyMessage={onCopyMessage}
                      onMessageMenu={onMessageMenu}
                      onOpenExternal={onOpenExternal}
                      onOpenPath={onOpenPath}
                    />
                  </div>
                ))}
              {messages.length > 0 &&
              windowed.range.end >= messages.length &&
              !revert &&
              turnDiff &&
              turnDiff.files.length > 0 ? (
                <div className="turn-diff" role="status">
                  <span className="turn-diff-text">
                    {turnDiff.files.length} {turnDiff.files.length === 1 ? 'file' : 'files'}
                    <span className="turn-diff-sep">·</span>
                    <span className="turn-diff-add">+{turnDiff.additions}</span>
                    <span className="turn-diff-del">−{turnDiff.deletions}</span>
                  </span>
                  <button
                    type="button"
                    className="turn-diff-review"
                    data-act="review-turn"
                    onClick={() => onReviewTurn(turnDiff.from)}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    className="turn-diff-undo"
                    data-act="undo-turn"
                    title="Undo this turn and restore its files"
                    disabled={busy || revertPending}
                    onClick={onUndoTurn}
                  >
                    Undo
                  </button>
                </div>
              ) : null}
              {noticeList}
              {busy && stickToBottom ? (
                <div className="working">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {connected && permissions.length > 0 ? (
        // Pinned above the revert card and the composer: a pending request
        // blocks the turn, so it must stay reachable at any scroll position.
        <div className="permission-foot">
          {permissions.map((request) => (
            <PermissionCard
              key={request.id}
              request={request}
              sending={permissionSending.includes(request.id)}
              onReply={(decision, message) => onPermissionReply(request, decision, message)}
            />
          ))}
        </div>
      ) : null}
      {revert && connected ? (
        // Pinned above the composer: Send is blocked until this is resolved, so
        // the card has to stay reachable at any scroll position and even when
        // the transcript renders no messages.
        <div className="revert-foot">
          <RevertCard
            revert={revert}
            busy={busy}
            pending={revertPending}
            onKeep={onKeepRevert}
            onUndo={onCancelRevert}
          />
        </div>
      ) : null}
      {undoRequest ? (
        <>
          <div className="revert-confirm-backdrop" onClick={onCancelUndo} />
          <div className="revert-confirm" role="dialog" aria-label="Undo this turn">
            <div className="revert-confirm-head">Undo this turn?</div>
            <div className="revert-confirm-sub">
              {undoRequest.files.length === 0
                ? 'The turn has no file changes'
                : `${undoRequest.files.length} ${
                    undoRequest.files.length === 1 ? 'file goes' : 'files go'
                  } back to the state before the turn`}
            </div>
            {undoRequest.files.length > 0 ? (
              <ul className="revert-files">
                {undoRequest.files.slice(0, REVERT_FILE_LIMIT).map((file, index) => (
                  <li className="revert-file" key={`${file.file}:${index}`} title={file.file}>
                    <span className="revert-file-name">{file.file}</span>
                    <span className="revert-file-stat">
                      <span className="turn-diff-add">+{file.additions}</span>
                      <span className="turn-diff-del">−{file.deletions}</span>
                    </span>
                  </li>
                ))}
                {undoRequest.files.length > REVERT_FILE_LIMIT ? (
                  <li className="revert-file revert-file-more">
                    +{undoRequest.files.length - REVERT_FILE_LIMIT} more
                  </li>
                ) : null}
              </ul>
            ) : null}
            <div className="revert-confirm-warn">
              Files are restored right away. Edits made after the turn are lost.
            </div>
            <div className="revert-confirm-actions">
              <button
                type="button"
                className="revert-confirm-primary"
                data-act="revert-confirm"
                disabled={revertPending}
                onClick={onConfirmUndo}
              >
                Revert files
              </button>
              <button
                type="button"
                data-act="revert-confirm-cancel"
                autoFocus
                onClick={onCancelUndo}
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}
      {showJump && !revert ? (
        <button
          type="button"
          className="jump-latest"
          aria-label="Jump to latest"
          onClick={jumpToLatest}
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}

/** Text of a system plaque; `permission` plaques carry the auto-approved tool. */
function noticeText(notice: UiNotice): string {
  if (notice.kind === 'revert') {
    return notice.text.length > 0 ? notice.text : 'Changes reverted';
  }
  if (notice.kind === 'permission') {
    return notice.text.length > 0 ? notice.text : 'Permission auto-approved';
  }
  return notice.reason === 'auto' ? 'Context compacted automatically' : 'Context compacted';
}

function captureAnchor(scroll: HTMLElement, thread: HTMLElement): ThreadAnchor | null {
  const items = thread.querySelectorAll<HTMLElement>('[data-thread-id]');
  const origin = scroll.getBoundingClientRect().top;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > origin + 1) {
      const id = item.dataset.threadId;
      return id ? { id, top: rect.top - origin } : null;
    }
  }
  return null;
}

function findItem(thread: HTMLElement, id: string): HTMLElement | null {
  const items = thread.querySelectorAll<HTMLElement>('[data-thread-id]');
  for (const item of items) {
    if (item.dataset.threadId === id) {
      return item;
    }
  }
  return null;
}

/** Air above and below the active match when it is scrolled into view. */
const RANGE_PADDING = 28;

interface RevealTarget {
  readonly id: string;
  readonly fallback: boolean;
}

/**
 * Collapsed reasoning and tool bodies have no DOM region, so their hits cannot
 * be highlighted or scrolled to. A jump opens the body the hit lives in; name
 * and title hits already sit in the always-rendered card head.
 */
function revealTarget(
  hit: SearchHit,
  messages: readonly UiMessage[],
  settings: SidekickSettings,
): RevealTarget | null {
  if (hit.region === 'user') {
    return null;
  }
  const [indexText, field] = hit.region.split(':');
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  const part = messages.find((message) => message.id === hit.messageId)?.parts[index];
  if (!part) {
    return null;
  }
  if (field === 'input' || field === 'output') {
    return part.kind === 'tool'
      ? { id: `${hit.messageId}:${index}`, fallback: !settings.compactTools }
      : null;
  }
  if (field !== undefined) {
    return null;
  }
  return part.kind === 'reasoning'
    ? { id: `${hit.messageId}:${index}`, fallback: settings.reasoning === 'expanded' }
    : null;
}

/**
 * Delta that brings the active match into the transcript viewport. Zero means
 * it is already visible with the padding around it.
 */
function rangeScrollDelta(scroll: HTMLElement, range: Range): number {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return 0;
  }
  const origin = scroll.getBoundingClientRect().top;
  const top = rect.top - origin;
  const bottom = rect.bottom - origin;
  if (top < RANGE_PADDING) {
    return top - RANGE_PADDING;
  }
  const limit = scroll.clientHeight - RANGE_PADDING;
  return bottom > limit ? bottom - limit : 0;
}

/**
 * Result of a staged revert: the files already went back on disk, so the card
 * only offers to keep that (and drop the turn) or to undo the revert. There is
 * no Review here: the turn's own diff no longer describes the files, and the
 * inverse patch would contradict the totals above.
 */
function RevertCard({
  revert,
  busy,
  pending,
  onKeep,
  onUndo,
}: {
  revert: TurnDiffSummary;
  busy: boolean;
  pending: boolean;
  onKeep: () => void;
  onUndo: () => void;
}): React.ReactElement {
  const count = revert.files.length;
  return (
    <div className="revert-card" role="status">
      <div className="revert-card-head">
        <span className="revert-card-title">Changes reverted</span>
        <span className="turn-diff-text">
          {count === 0 ? (
            'No file changes'
          ) : (
            <>
              {count} {count === 1 ? 'file' : 'files'}
              <span className="turn-diff-sep">·</span>
              <span className="turn-diff-add">+{revert.additions}</span>
              <span className="turn-diff-del">−{revert.deletions}</span>
            </>
          )}
        </span>
      </div>
      {count > 0 ? (
        <ul className="revert-files">
          {revert.files.slice(0, REVERT_FILE_LIMIT).map((file, index) => (
            <li className="revert-file" key={`${file.file}:${index}`} title={file.file}>
              <span className="revert-file-name">{file.file}</span>
              <span className="revert-file-stat">
                <span className="turn-diff-add">+{file.additions}</span>
                <span className="turn-diff-del">−{file.deletions}</span>
              </span>
            </li>
          ))}
          {count > REVERT_FILE_LIMIT ? (
            <li className="revert-file revert-file-more">
              +{count - REVERT_FILE_LIMIT} more
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="revert-card-hint">
        Keep drops the turn; Undo revert restores the files.
      </div>
      <div className="revert-card-actions">
        <button
          type="button"
          className="revert-card-keep"
          data-act="revert-keep"
          disabled={pending || busy}
          onClick={onKeep}
        >
          Keep
        </button>
        <button
          type="button"
          data-act="revert-undo"
          disabled={pending || busy}
          onClick={onUndo}
        >
          Undo revert
        </button>
      </div>
    </div>
  );
}

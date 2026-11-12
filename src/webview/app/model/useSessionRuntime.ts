import * as React from 'react';
import { EMPTY_SESSION_RUNTIME } from '../../../shared/session-runtime';
import { post } from '../../shared/api/vscode';
import type { ModelSelection, SessionRuntimeState } from '../../shared/types/domain';

function normalize(runtime: SessionRuntimeState | null | undefined): SessionRuntimeState {
  if (!runtime) {
    return EMPTY_SESSION_RUNTIME;
  }
  return {
    ...EMPTY_SESSION_RUNTIME,
    ...runtime,
    toggles: runtime.toggles ?? {},
  };
}

function sameModel(
  left: SessionRuntimeState['model'],
  right: ModelSelection | null,
): boolean {
  return (
    (left?.id ?? '') === (right?.id ?? '') &&
    (left?.providerID ?? '') === (right?.providerID ?? '') &&
    (left?.variant ?? '') === (right?.variant ?? '')
  );
}

const NEW_SESSION_PREFIX = '__new__';

export function useSessionRuntime({
  activeId,
  directory,
  runtime,
  model,
  mode,
}: {
  activeId: string | null;
  /** Workspace folder in use; a new chat is a draft per folder. */
  directory: string;
  runtime: SessionRuntimeState | null;
  model: ModelSelection | null;
  mode: string | null;
}) {
  const [states, setStates] = React.useState<Record<string, SessionRuntimeState>>({});
  const hostRuntime = React.useRef(runtime);
  hostRuntime.current = runtime;
  const statesRef = React.useRef(states);
  statesRef.current = states;
  const previousActive = React.useRef<string | null>(null);

  const key = activeId ?? `${NEW_SESSION_PREFIX}:${directory}`;
  const state = normalize(states[key] ?? (activeId ? runtime : null));

  const setDraft = React.useCallback<React.Dispatch<React.SetStateAction<string>>>(
    (value) => {
      setStates((previous) => {
        const current = previous[key] ?? normalize(hostRuntime.current);
        const draft = typeof value === 'function' ? value(current.draft) : value;
        return {
          ...previous,
          [key]: {
            ...current,
            draft,
            caret: Math.min(current.caret, draft.length),
            selectionEnd: Math.min(current.selectionEnd, draft.length),
          },
        };
      });
    },
    [key],
  );

  const setToggles = React.useCallback<
    React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  >(
    (value) => {
      setStates((previous) => {
        const current = previous[key] ?? normalize(hostRuntime.current);
        const toggles = typeof value === 'function' ? value(current.toggles) : value;
        return { ...previous, [key]: { ...current, toggles } };
      });
    },
    [key],
  );

  const setScroll = React.useCallback(
    (scrollTop: number, stickToBottom: boolean, distanceFromBottom: number) => {
      setStates((previous) => {
        const current = previous[key] ?? normalize(hostRuntime.current);
        if (
          current.stickToBottom === stickToBottom &&
          Math.abs(current.scrollTop - scrollTop) < 2 &&
          Math.abs(current.distanceFromBottom - distanceFromBottom) < 2
        ) {
          return previous;
        }
        return {
          ...previous,
          [key]: { ...current, scrollTop, stickToBottom, distanceFromBottom },
        };
      });
    },
    [key],
  );

  const setCaret = React.useCallback(
    (caret: number, selectionEnd: number) => {
      setStates((previous) => {
        const current = previous[key] ?? normalize(hostRuntime.current);
        if (current.caret === caret && current.selectionEnd === selectionEnd) {
          return previous;
        }
        return { ...previous, [key]: { ...current, caret, selectionEnd } };
      });
    },
    [key],
  );

  const modelKey = model ? `${model.providerID}/${model.id}/${model.variant ?? ''}` : '';
  React.useEffect(() => {
    if (!activeId) {
      return;
    }
    setStates((previous) => {
      const current = previous[key] ?? normalize(hostRuntime.current);
      const nextModel: SessionRuntimeState['model'] = model
        ? { id: model.id, providerID: model.providerID, variant: model.variant }
        : undefined;
      if (
        sameModel(current.model, model) &&
        current.effort === model?.variant &&
        current.mode === (mode ?? undefined)
      ) {
        return previous;
      }
      return {
        ...previous,
        [key]: {
          ...current,
          model: nextModel,
          effort: model?.variant,
          mode: mode ?? undefined,
        },
      };
    });
  }, [activeId, key, modelKey, mode]);

  React.useEffect(() => {
    const previous = previousActive.current;
    if (previous && previous !== key) {
      if (!previous.startsWith(`${NEW_SESSION_PREFIX}:`)) {
        const departing = statesRef.current[previous];
        if (departing) {
          post({ type: 'updateSessionRuntime', id: previous, runtime: departing });
        }
      } else if (activeId && previous === `${NEW_SESSION_PREFIX}:${directory}`) {
        // The first send turns the draft of the same folder into a real session.
        // A draft of another folder stays where it is: switching folders must
        // not hand folder A's text to a session created in folder B.
        const carried = statesRef.current[previous];
        if (carried) {
          setStates((previousStates) => {
            if (previousStates[activeId]) {
              return previousStates;
            }
            const next = { ...previousStates, [activeId]: carried };
            delete next[previous];
            return next;
          });
        }
      }
    }
    previousActive.current = key;
  }, [activeId, directory, key]);

  const activeState = activeId ? states[activeId] : undefined;
  React.useEffect(() => {
    if (!activeId || !activeState) {
      return;
    }
    const timer = window.setTimeout(() => {
      post({ type: 'updateSessionRuntime', id: activeId, runtime: activeState });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeId, activeState]);

  return {
    draft: state.draft,
    setDraft,
    toggles: state.toggles,
    setToggles,
    scrollTop: state.scrollTop,
    stickToBottom: state.stickToBottom,
    distanceFromBottom: state.distanceFromBottom,
    setScroll,
    caret: state.caret,
    selectionEnd: state.selectionEnd,
    setCaret,
  };
}

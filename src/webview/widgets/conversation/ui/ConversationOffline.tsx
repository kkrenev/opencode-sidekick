import * as React from 'react';

export function ConversationOffline({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div className="offline">
      <strong>OpenCode is not reachable</strong>
      <div>{error || 'Start the OpenCode server and try again.'}</div>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

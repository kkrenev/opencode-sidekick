import * as React from 'react';

export function ConversationOffline({
  error,
  canResend,
  onRetry,
  onResend,
}: {
  error: string | null;
  /** A send of this chat never reached the server and can be repeated. */
  canResend: boolean;
  onRetry: () => void;
  onResend: () => void;
}): React.ReactElement {
  return (
    <div className="offline">
      <strong>OpenCode is not reachable</strong>
      <div>{error || 'Start the OpenCode server and try again.'}</div>
      <div className="offline-actions">
        <button type="button" onClick={onRetry}>
          Retry
        </button>
        <button
          type="button"
          className="secondary"
          onClick={onResend}
          disabled={!canResend}
          title={
            canResend
              ? 'Send the message that failed again'
              : 'There is no failed message to send again'
          }
        >
          Resend
        </button>
      </div>
    </div>
  );
}

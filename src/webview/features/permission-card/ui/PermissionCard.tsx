import * as React from 'react';
import {
  canAlwaysAllow,
  permissionRisk,
  permissionRiskLabel,
  permissionSummary,
  type PermissionDecision,
  type PermissionRequest,
} from '../../../../shared/permission';

/** Resources listed on the card; the rest becomes a count. */
const RESOURCE_LIMIT = 3;

/**
 * A pending permission request. The card never answers on its own and never
 * disappears optimistically: the host drops it when the server confirms.
 */
export function PermissionCard({
  request,
  sending,
  onReply,
}: {
  request: PermissionRequest;
  sending: boolean;
  onReply: (decision: PermissionDecision, message?: string) => void;
}): React.ReactElement {
  const [stage, setStage] = React.useState<'ask' | 'reject'>('ask');
  const [reason, setReason] = React.useState('');
  const reasonRef = React.useRef<HTMLTextAreaElement | null>(null);
  const summary = permissionSummary(request);
  const risk = permissionRisk(request.action);
  const resources = request.resources;
  const hidden = Math.max(0, resources.length - RESOURCE_LIMIT);
  // `always` stores the patterns the server offered; without them there is no
  // rule to create, so the button is off instead of silently answering once.
  const canAlways = canAlwaysAllow(request);

  // The reason step replaces the buttons; focus it so the keyboard user can
  // type the reason (or Escape is at least one Tab away) without hunting.
  React.useEffect(() => {
    if (stage === 'reject') {
      reasonRef.current?.focus();
    }
  }, [stage]);

  if (stage === 'reject') {
    return (
      <div className="permission-card reject" role="group" aria-label="Reject permission">
        <div className="permission-head">
          <span className="permission-title">Reject this request?</span>
          <span className={`permission-risk ${risk}`}>{permissionRiskLabel(risk)}</span>
        </div>
        <div className="permission-summary">{summary.title}</div>
        <textarea
          className="permission-reason"
          aria-label="Why is it rejected? (optional)"
          placeholder="Why is it rejected? (optional)"
          value={reason}
          rows={2}
          disabled={sending}
          ref={reasonRef}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="permission-actions">
          <button
            type="button"
            className="permission-primary"
            data-act="permission-reject-confirm"
            disabled={sending}
            onClick={() => onReply('reject', reason.trim() || undefined)}
          >
            Send rejection
          </button>
          <button
            type="button"
            data-act="permission-reject-cancel"
            disabled={sending}
            onClick={() => {
              setStage('ask');
              setReason('');
            }}
          >
            Cancel
          </button>
        </div>
        {sending ? <div className="permission-sending">Waiting for the server…</div> : null}
      </div>
    );
  }

  return (
    <div className="permission-card" role="group" aria-label="Permission needed">
      <div className="permission-head">
        <span className="permission-title">Permission needed</span>
        <span className={`permission-risk ${risk}`}>{permissionRiskLabel(risk)}</span>
      </div>
      <div className="permission-summary" title={request.action}>
        {summary.title}
      </div>
      {summary.detail ? <div className="permission-detail">{summary.detail}</div> : null}
      {resources.length > 1 ? (
        <ul className="permission-resources">
          {resources.slice(0, RESOURCE_LIMIT).map((resource, index) => (
            <li className="permission-resource" key={`${resource}:${index}`} title={resource}>
              {resource}
            </li>
          ))}
          {hidden > 0 ? (
            <li className="permission-resource permission-resource-more">+{hidden} more</li>
          ) : null}
        </ul>
      ) : null}
      {request.message ? <div className="permission-message">{request.message}</div> : null}
      <div className="permission-actions">
        <button
          type="button"
          className="permission-primary"
          data-act="permission-once"
          disabled={sending}
          onClick={() => onReply('once')}
        >
          Allow once
        </button>
        <button
          type="button"
          data-act="permission-always"
          disabled={sending || !canAlways}
          title={canAlways ? undefined : 'This request has no rule to save'}
          onClick={() => onReply('always')}
        >
          Always allow
        </button>
        <button
          type="button"
          data-act="permission-reject"
          disabled={sending}
          onClick={() => setStage('reject')}
        >
          Reject
        </button>
      </div>
      {sending ? <div className="permission-sending">Waiting for the server…</div> : null}
    </div>
  );
}

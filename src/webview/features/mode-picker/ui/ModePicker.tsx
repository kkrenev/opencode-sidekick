import * as React from 'react';
import { primaryAgents } from '../../../entities/agent/lib/agent';
import type { AgentEntry } from '../../../shared/types/domain';
import { Icon } from '../../../shared/ui/Icon';
import { Popover } from '../../../shared/ui/Popover';

export function ModePicker({
  anchor,
  agents,
  current,
  defaultMode,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null;
  agents: readonly AgentEntry[];
  current: string | undefined;
  defaultMode: string | undefined;
  onSelect: (agent: AgentEntry) => void;
  onClose: () => void;
}): React.ReactElement {
  const options = primaryAgents(agents);
  return (
    <Popover anchor={anchor} onClose={onClose} className="picker mode-picker">
      <div className="popover-title">Mode</div>
      <div className="popover-list" id="popover-list">
        {options.map((agent) => {
          const active = current === agent.id;
          return (
            <button
              key={agent.id}
              className={`row${active ? ' active' : ''}`}
              type="button"
              data-act="pick-mode"
              data-id={agent.id}
              onClick={() => onSelect(agent)}
            >
              <span className="row-main">
                <span className="row-title">{agent.name || agent.id}</span>
                {agent.description ? <span className="row-sub">{agent.description}</span> : null}
              </span>
              {defaultMode === agent.id && !active ? (
                <span className="row-default">default</span>
              ) : null}
              {active ? (
                <span className="row-check">
                  <Icon name="checkSmall" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

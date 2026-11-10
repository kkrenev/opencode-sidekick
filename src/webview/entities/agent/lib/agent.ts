import { capitalize } from '../../../shared/lib/format';
import type { AgentEntry } from '../../../shared/types/domain';

export function primaryAgents(agents: readonly AgentEntry[]): AgentEntry[] {
  const visible = agents.filter((agent) => !agent.hidden);
  const primary = visible.filter((agent) => agent.mode === 'primary');
  return primary.length > 0 ? primary : visible;
}

export function effectiveAgent(
  agent: string | null | undefined,
  fallback: string | undefined,
): string | undefined {
  return agent ?? fallback;
}

export function agentName(
  agents: readonly AgentEntry[],
  id: string | null | undefined,
): string {
  const agent = agents.find((entry) => entry.id === id);
  return agent ? agent.name : id ? capitalize(id) : 'Mode';
}

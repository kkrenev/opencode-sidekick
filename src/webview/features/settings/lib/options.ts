import type { AccentColor } from '../../../shared/config/settings';
import type { ModelEntry } from '../../../shared/types/domain';

export const ACCENTS: { value: AccentColor; label: string; color: string }[] = [
  { value: 'mint', label: 'Mint', color: '#3ddc97' },
  { value: 'blue', label: 'Blue', color: '#5b9dff' },
  { value: 'violet', label: 'Violet', color: '#a78bfa' },
  { value: 'amber', label: 'Amber', color: '#f0b429' },
];

export function modelsByProvider(
  models: readonly ModelEntry[],
): { provider: string; models: ModelEntry[] }[] {
  const groups = new Map<string, ModelEntry[]>();
  for (const model of models) {
    const list = groups.get(model.providerID) || [];
    list.push(model);
    groups.set(model.providerID, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, list]) => ({
      provider,
      models: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

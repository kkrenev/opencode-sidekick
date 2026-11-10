import { capitalize, shortModel } from '../../../shared/lib/format';
import type {
  DefaultSelection,
  ModelEntry,
  ModelSelection,
  ModelVariant,
} from '../../../shared/types/domain';

export const EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export function variantLabel(id: string | undefined): string {
  return id ? EFFORT_LABELS[id] || capitalize(id) : '';
}

export function modelEntryFor(
  models: readonly ModelEntry[],
  ref: ModelSelection | null | undefined,
): ModelEntry | undefined {
  if (!ref) {
    return undefined;
  }
  return models.find((model) => model.id === ref.id && model.providerID === ref.providerID);
}

export function modelName(
  models: readonly ModelEntry[],
  ref: ModelSelection | null | undefined,
): string {
  const entry = modelEntryFor(models, ref);
  return entry ? entry.name : ref ? shortModel(ref.id) : 'Model';
}

export function variantsFor(
  models: readonly ModelEntry[],
  ref: ModelSelection | null | undefined,
): readonly ModelVariant[] {
  return modelEntryFor(models, ref)?.variants ?? [];
}

export function modelSettingValue(ref: ModelSelection | null | undefined): string {
  return ref ? `${ref.providerID}/${ref.id}` : '';
}

export function modelSettingRef(value: string): ModelSelection | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return undefined;
  }
  return {
    providerID: trimmed.slice(0, slash),
    id: trimmed.slice(slash + 1),
  };
}

export function preservedVariant(
  model: ModelEntry,
  current: string | undefined,
): string | undefined {
  if (current && model.variants.some((variant) => variant.id === current)) {
    return current;
  }
  return undefined;
}

export function effortText(
  current: ModelSelection | null | undefined,
  defaults: DefaultSelection,
  model: ModelEntry | undefined,
): string {
  if (current?.variant) {
    return variantLabel(current.variant);
  }
  if (model && model.variants.length === 0) {
    return 'No effort';
  }
  const defaultModel = defaults.model;
  const usingDefaultModel =
    model &&
    defaultModel &&
    model.id === defaultModel.id &&
    model.providerID === defaultModel.providerID;
  if (defaults.effort && usingDefaultModel) {
    return variantLabel(defaults.effort);
  }
  return 'Default effort';
}

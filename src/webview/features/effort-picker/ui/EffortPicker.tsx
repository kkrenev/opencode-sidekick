import * as React from 'react';
import { variantLabel } from '../../../entities/model/lib/model';
import type { ModelEntry } from '../../../shared/types/domain';
import { Icon } from '../../../shared/ui/Icon';
import { Popover } from '../../../shared/ui/Popover';

export function EffortPicker({
  anchor,
  model,
  selected,
  defaultEffort,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null;
  model: ModelEntry | undefined;
  selected: string | undefined;
  defaultEffort: string | undefined;
  onSelect: (variant: string | undefined) => void;
  onClose: () => void;
}): React.ReactElement {
  const variants = model?.variants ?? [];
  const active = selected ?? '';
  return (
    <Popover anchor={anchor} onClose={onClose} className="picker effort-picker">
      <div className="popover-title">Effort{model ? ` · ${model.name}` : ''}</div>
      <div className="popover-list" id="popover-list">
        <button
          className={`row${active === '' ? ' active' : ''}`}
          type="button"
          data-act="pick-effort"
          data-variant=""
          onClick={() => onSelect(undefined)}
        >
          <span className="row-main">
            <span className="row-title">Default</span>
            <span className="row-sub">
              {variants.length > 0 ? 'Let the server pick' : 'No effort settings for this model'}
            </span>
          </span>
          {defaultEffort && active !== '' ? (
            <span className="row-default">{variantLabel(defaultEffort)}</span>
          ) : null}
          {active === '' ? (
            <span className="row-check">
              <Icon name="checkSmall" />
            </span>
          ) : null}
        </button>
        {variants.map((variant) => (
          <button
            key={variant.id}
            className={`row${active === variant.id ? ' active' : ''}`}
            type="button"
            data-act="pick-effort"
            data-variant={variant.id}
            onClick={() => onSelect(variant.id)}
          >
            <span className="row-main">
              <span className="row-title">{variantLabel(variant.id)}</span>
              {variant.effort && variant.effort !== variant.id ? (
                <span className="row-sub">{variant.effort}</span>
              ) : null}
            </span>
            {defaultEffort === variant.id ? <span className="row-default">default</span> : null}
            {active === variant.id ? (
              <span className="row-check">
                <Icon name="checkSmall" />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </Popover>
  );
}

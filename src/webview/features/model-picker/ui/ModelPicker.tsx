import * as React from 'react';
import { variantLabel } from '../../../entities/model/lib/model';
import type { DefaultSelection, ModelEntry, ModelSelection } from '../../../shared/types/domain';
import { Popover } from '../../../shared/ui/Popover';
import { PopoverHeader } from '../../../shared/ui/PopoverHeader';

export function ModelPicker({
  anchor,
  models,
  current,
  defaults,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null;
  models: readonly ModelEntry[];
  current: ModelSelection | undefined;
  defaults: DefaultSelection;
  onSelect: (model: ModelEntry) => void;
  onClose: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const initialIndex = React.useMemo(() => {
    const ref = current ?? defaults.model;
    const index = ref
      ? models.findIndex((model) => model.id === ref.id && model.providerID === ref.providerID)
      : 0;
    return index >= 0 ? index : 0;
  }, [current, defaults.model, models]);
  const [active, setActive] = React.useState(initialIndex);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return models;
    }
    return models.filter((model) =>
      `${model.name} ${model.id} ${model.providerID}`.toLowerCase().includes(needle),
    );
  }, [models, query]);

  React.useEffect(() => {
    if (active >= visible.length) {
      setActive(0);
    }
  }, [active, visible.length]);

  const choose = (model: ModelEntry | undefined) => {
    if (model) {
      onSelect(model);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} className="picker model-picker">
      <PopoverHeader
        title="Model"
        search
        searchPlaceholder="Search models"
        searchValue={query}
        onSearch={(value) => {
          setQuery(value);
          setActive(0);
        }}
        onSearchKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (visible.length > 0) {
              setActive((value) => (value + 1) % visible.length);
            }
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (visible.length > 0) {
              setActive((value) => (value - 1 + visible.length) % visible.length);
            }
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            choose(visible[active]);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="popover-list" id="popover-list">
        {visible.length === 0 ? (
          <div className="popover-empty">No models match</div>
        ) : (
          visible.map((model, index) => {
            const isCurrent =
              current?.id === model.id && current?.providerID === model.providerID;
            const isDefault =
              defaults.model?.id === model.id &&
              defaults.model?.providerID === model.providerID;
            const variant = isCurrent ? current?.variant : undefined;
            return (
              <button
                key={`${model.providerID}/${model.id}`}
                className={`row${index === active ? ' active' : ''}${isCurrent ? ' current' : ''}`}
                type="button"
                data-act="pick-model"
                data-id={model.id}
                data-provider={model.providerID}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(model)}
              >
                <span className="row-main">
                  <span className="row-title">{model.name}</span>
                  <span className="row-sub">
                    {model.providerID}
                    {model.variants.length > 0
                      ? ` · ${model.variants.length} effort levels`
                      : ''}
                  </span>
                </span>
                {variant ? <span className="row-badge">{variantLabel(variant)}</span> : null}
                {isDefault && !isCurrent ? <span className="row-default">default</span> : null}
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
}

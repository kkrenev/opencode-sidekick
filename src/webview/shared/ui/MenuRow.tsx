import * as React from 'react';
import { Icon, type IconName } from './Icon';

/** One actionable line of a popover menu. */
export function MenuRow({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button className="row" type="button" title={title} disabled={disabled} onClick={onClick}>
      <span className="row-glyph">
        <Icon name={icon} />
      </span>
      <span className="row-main">
        <span className="row-title">{label}</span>
      </span>
    </button>
  );
}

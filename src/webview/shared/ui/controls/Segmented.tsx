import * as React from 'react';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? 'active' : ''}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

import * as React from 'react';

export function PopoverHeader({
  title,
  search,
  searchPlaceholder,
  searchValue,
  onSearch,
  onSearchKeyDown,
}: {
  title?: string;
  search?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearch?: (value: string) => void;
  onSearchKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (search) {
      inputRef.current?.focus();
    }
  }, [search]);
  return (
    <>
      {title ? <div className="popover-title">{title}</div> : null}
      {search ? (
        <div className="popover-search">
          <input
            ref={inputRef}
            id="popover-input"
            type="text"
            placeholder={searchPlaceholder || 'Search'}
            value={searchValue || ''}
            onChange={(event) => onSearch?.(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      ) : null}
    </>
  );
}

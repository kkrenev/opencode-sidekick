import * as React from 'react';

export const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="4.5" width="18.5" height="12" rx="3.2"/><path d="M7.75 16.5v3.6l4.3-3.6"/><path d="M8.7 8.9 11.2 11l-2.5 2.1"/><path d="M13.4 13.1h2.9"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  history: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4.2V8l2.6 1.6"/><circle cx="8" cy="8" r="5.4"/></svg>',
  dots: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.6" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.4" cy="8" r="1.1"/></svg>',
  send: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5v-9M4.4 7.1 8 3.5l3.6 3.6"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="5" width="6" height="6" rx="1.2"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5h9M6.5 5V3.6h3V5M5 5l.5 7.5h5L11 5"/></svg>',
  terminal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2"/><path d="m5.2 6.6 2 1.6-2 1.6M8.8 10h2.2"/></svg>',
  external: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5H12.5V6.5M12.2 3.8 7.8 8.2"/><path d="M11.5 9.6v2.2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2.2"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 7.2a4.7 4.7 0 1 1-1.4-3.3"/><path d="M12.9 2.8v2.6h-2.6"/></svg>',
  model: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.4 13 5v6L8 13.6 3 11V5z"/><path d="M8 8.2v5.4M8 8.2 13 5M8 8.2 3 5"/></svg>',
  agent: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.4" width="10" height="7" rx="2.2"/><path d="M8 3v2.4M6 8.6v.8M10 8.6v.8"/></svg>',
  effort: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 11.4a5.9 5.9 0 1 1 10.8 0"/><path d="M8 11.4 10.6 7"/><circle cx="8" cy="11.4" r="1.1" fill="currentColor" stroke="none"/></svg>',
  command: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 3.2 3.6 8l2.8 4.8M9.6 3.2 12.4 8l-2.8 4.8"/></svg>',
  skill: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.4 9.5 6l3.6 1.5-3.6 1.5L8 12.6 6.5 9 2.9 7.5 6.5 6z"/></svg>',
  checkSmall: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.6 8.4 2.8 2.8 6-6"/></svg>',
  shell: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m4.4 5.4 2.6 2.6-2.6 2.6M9 10.6h2.8"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.6h5l3 3v7.8H4z"/><path d="M9 2.6v3h3"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="7.2" cy="7.2" r="4"/><path d="m10.2 10.2 2.4 2.4"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.6 8.4 2.8 2.8 6-6"/></svg>',
  alert: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 5.2v3.6M8 11.2v.2"/><circle cx="8" cy="8" r="5.6"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 2.3v1.4M8 12.3v1.4M2.3 8h1.4M12.3 8h1.4M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1"/></svg>',
  sliders: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.5" cy="11.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

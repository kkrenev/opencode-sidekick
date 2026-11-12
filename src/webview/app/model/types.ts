import type { PopoverAnchor } from '../../shared/ui/Popover';

export type PopoverState =
  | { kind: 'menu'; anchor: HTMLElement }
  | { kind: 'model'; anchor: HTMLElement }
  | { kind: 'effort'; anchor: HTMLElement }
  | { kind: 'mode'; anchor: HTMLElement }
  | { kind: 'attach'; anchor: HTMLElement }
  | { kind: 'tab'; anchor: HTMLElement; id: string }
  | { kind: 'message'; anchor: PopoverAnchor; id: string };

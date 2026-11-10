export type PopoverState =
  | { kind: 'menu'; anchor: HTMLElement }
  | { kind: 'model'; anchor: HTMLElement }
  | { kind: 'effort'; anchor: HTMLElement }
  | { kind: 'mode'; anchor: HTMLElement };

export function chipAnchor(kind: 'model' | 'effort' | 'mode' | 'attach-menu'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.chip[data-act="${kind}"]`);
}

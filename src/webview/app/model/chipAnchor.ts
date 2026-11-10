export function chipAnchor(kind: 'model' | 'effort' | 'mode'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.chip[data-act="${kind}"]`);
}

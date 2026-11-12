/**
 * Pasting a wall of text into the composer is almost always a file in
 * disguise: pasted code, logs or a whole document. Past this size the composer
 * offers to attach it as a file, but the native paste always happens first, so
 * the text is never lost.
 */
export const PASTE_ATTACH_THRESHOLD = 8000;

export function pastedTextFile(text: string, now: Date = new Date()): File {
  return new File([text], pastedTextName(now), { type: 'text/plain' });
}

function pastedTextName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pasted-${stamp}-${time}.txt`;
}

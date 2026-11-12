import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installHostStub, resetHostStub } from './host';

// Runs before the first test module import, so `shared/api/vscode.ts` finds the
// host stub when it calls `acquireVsCodeApi()` at module scope.
installHostStub();

// jsdom has no layout engine; the popover and the composer only need an object
// with the observer methods to measure nothing.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// The tab strip scrolls the active tab into view; jsdom leaves the method out.
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
  resetHostStub();
});

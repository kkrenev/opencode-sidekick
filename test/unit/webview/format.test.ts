import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatCost,
  formatTokens,
  sendHint,
  shortModel,
} from '../../../src/webview/shared/lib/format';

describe('formatTokens', () => {
  it('keeps a small count as it is', () => {
    expect(formatTokens(999)).toBe('999');
  });

  it('switches to k at a thousand', () => {
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1400)).toBe('1.4k');
  });

  it('switches to M at a million', () => {
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(1_400_000)).toBe('1.4M');
  });

  it('shows a dash while the value is unknown', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(undefined)).toBe('—');
    expect(formatTokens(Number.NaN)).toBe('—');
  });
});

describe('formatCost', () => {
  it('hides a zero or unknown cost', () => {
    expect(formatCost(0)).toBe('');
    expect(formatCost(undefined)).toBe('');
  });

  it('prints four decimals of a real cost', () => {
    expect(formatCost(0.01234)).toBe('$0.0123');
  });
});

describe('escapeHtml', () => {
  it('escapes every markup character', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });
});

describe('shortModel', () => {
  it('drops the provider prefix and the dashes', () => {
    expect(shortModel('@openai/gpt-5.1-codex-max')).toBe('gpt 5.1 codex max');
    expect(shortModel('claude-sonnet')).toBe('claude sonnet');
  });

  it('falls back to a label without a model', () => {
    expect(shortModel(undefined)).toBe('Model');
  });
});

describe('sendHint', () => {
  it('describes the configured send key', () => {
    expect(sendHint('enter')).toBe('Enter send · Shift+Enter new line');
    expect(sendHint('mod-enter')).toBe('Cmd/Ctrl+Enter send · Enter new line');
  });
});

import { describe, expect, it } from 'vitest';
import {
  commandPaletteItems,
  detectPalette,
  matchLocalCommand,
  mentionPaletteItems,
} from '../../../src/webview/features/composer-palette/lib/palette';

describe('detectPalette', () => {
  it('opens the slash palette at the start of a line', () => {
    expect(detectPalette('/mod', 4)).toEqual({ kind: 'slash', start: 0, end: 4, query: 'mod' });
    expect(detectPalette('hi\n/ne', 6)).toEqual({ kind: 'slash', start: 3, end: 6, query: 'ne' });
  });

  it('does not open the slash palette inside a word', () => {
    expect(detectPalette('a /x', 4)).toBeNull();
  });

  it('opens the mention palette after whitespace', () => {
    expect(detectPalette('hello @src', 10)).toEqual({
      kind: 'mention',
      start: 6,
      end: 10,
      query: 'src',
    });
  });

  it('stays closed for plain text', () => {
    expect(detectPalette('hello', 5)).toBeNull();
  });
});

describe('commandPaletteItems', () => {
  it('lists the local commands before the server ones and never repeats a name', () => {
    const items = commandPaletteItems(
      [
        { name: 'new', description: 'Server side new' },
        { name: 'deploy', description: 'Deploy the app' },
      ],
      '',
    );

    expect(items[0]).toMatchObject({ kind: 'action', id: 'new', label: '/new', action: 'new' });
    expect(items.filter((item) => item.id === 'new')).toHaveLength(1);
    expect(items.at(-1)).toEqual({
      kind: 'command',
      id: 'deploy',
      label: '/deploy',
      description: 'Deploy the app',
      insert: '/deploy ',
    });
  });

  it('filters by name and description', () => {
    const items = commandPaletteItems([{ name: 'deploy', description: 'Ship it' }], 'ship');

    expect(items).toEqual([
      {
        kind: 'command',
        id: 'deploy',
        label: '/deploy',
        description: 'Ship it',
        insert: '/deploy ',
      },
    ]);
  });
});

describe('mentionPaletteItems', () => {
  it('lists skills first and files after them', () => {
    const items = mentionPaletteItems(
      [{ id: 'pdf', name: 'PDF', description: 'Read a PDF' }],
      [
        { path: 'src/a.ts', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
      '',
    );

    expect(items.map((item) => [item.kind, item.label, item.description])).toEqual([
      ['skill', '@pdf', 'Read a PDF'],
      ['file', '@src/a.ts', 'file'],
      ['file', '@src', 'folder'],
    ]);
  });

  it('filters skills and files by the query', () => {
    const items = mentionPaletteItems(
      [{ id: 'pdf', name: 'PDF' }],
      [{ path: 'src/a.ts', type: 'file' }],
      'src',
    );

    expect(items.map((item) => item.id)).toEqual(['src/a.ts']);
  });
});

describe('matchLocalCommand', () => {
  it('matches a command with and without arguments', () => {
    expect(matchLocalCommand('/new')).toMatchObject({ name: 'new', action: 'new' });
    expect(matchLocalCommand('/new now please')).toMatchObject({ name: 'new' });
  });

  it('ignores an unknown command and plain text', () => {
    expect(matchLocalCommand('/nope')).toBeNull();
    expect(matchLocalCommand('new')).toBeNull();
  });
});

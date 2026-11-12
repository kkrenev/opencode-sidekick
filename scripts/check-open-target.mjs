import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {
  cleanPath,
  fileUriPath,
  normalizeLine,
  openTargetFor,
  relativeToRoot,
  resolveOpenTarget,
  withinRoots,
} = require(resolve(root, 'out/shared/open-target.js'));

let failures = 0;

function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const roots = ['/work/project', '/home/user/.vscode/attachments'];
const directory = '/work/project';

// fileUriPath: only a file: URI has a path, and it survives percent encoding.
check('a file URI becomes an absolute path', () => {
  assert.equal(fileUriPath('file:///work/project/src/a.ts'), '/work/project/src/a.ts');
  assert.equal(fileUriPath('file:///work/project/src/a%20b.ts'), '/work/project/src/a b.ts');
  assert.equal(fileUriPath('file://localhost/work/project/a.ts'), '/work/project/a.ts');
  assert.equal(fileUriPath('file:///C:/work/project/a.ts'), 'C:/work/project/a.ts');
  assert.equal(fileUriPath('file://server/share/a.ts'), '//server/share/a.ts');
});

check('other schemes are not files', () => {
  assert.equal(fileUriPath('data:image/png;base64,AAAA'), undefined);
  assert.equal(fileUriPath('https://example.com/a.png'), undefined);
  assert.equal(fileUriPath(''), undefined);
  assert.equal(fileUriPath('/work/project/a.ts'), undefined);
  assert.equal(fileUriPath('file:///work/%E0%A4%A'), undefined);
});

// cleanPath: `..` is refused instead of resolved, so nothing escapes a root.
check('paths are normalized without empty or dot segments', () => {
  assert.equal(cleanPath('/work/project/src/a.ts'), '/work/project/src/a.ts');
  assert.equal(cleanPath('/work/project//src/./a.ts'), '/work/project/src/a.ts');
  assert.equal(cleanPath('src\\nested\\a.ts'), 'src/nested/a.ts');
  assert.equal(cleanPath('C:\\work\\a.ts'), 'C:/work/a.ts');
  assert.equal(cleanPath('/work/project/'), '/work/project');
});

check('escaping and empty paths are refused', () => {
  assert.equal(cleanPath('/work/project/../secrets.txt'), undefined);
  assert.equal(cleanPath('../secrets.txt'), undefined);
  assert.equal(cleanPath(''), undefined);
  assert.equal(cleanPath('   '), undefined);
  assert.equal(cleanPath('.'), undefined);
});

// withinRoots: a sibling with the same prefix is outside the root.
check('only paths below a root are inside it', () => {
  assert.equal(withinRoots(roots, '/work/project/src/a.ts'), true);
  assert.equal(withinRoots(roots, '/work/project'), true);
  assert.equal(withinRoots(roots, '/home/user/.vscode/attachments/shot.png'), true);
  assert.equal(withinRoots(roots, '/work/project-evil/a.ts'), false);
  assert.equal(withinRoots(roots, '/etc/passwd'), false);
  assert.equal(withinRoots(roots, 'src/a.ts'), false);
  assert.equal(withinRoots([], '/work/project/a.ts'), false);
});

// relativeToRoot: the transcript shows the workspace-relative path.
check('a path inside a root is shown relative to it', () => {
  assert.equal(relativeToRoot(roots, '/work/project/src/a.ts'), 'src/a.ts');
  assert.equal(relativeToRoot(roots, '/work/project/a.ts'), 'a.ts');
  assert.equal(relativeToRoot(roots, '/work/project'), undefined);
  assert.equal(relativeToRoot(roots, '/work/other/a.ts'), undefined);
  assert.equal(relativeToRoot(roots, 'src/a.ts'), undefined);
});

// resolveOpenTarget: relative values resolve against the chat directory.
check('a relative path resolves inside the workspace', () => {
  assert.deepEqual(resolveOpenTarget(roots, directory, 'src/a.ts', 12), {
    fsPath: '/work/project/src/a.ts',
    line: 12,
  });
  assert.equal(resolveOpenTarget(roots, directory, './src/a.ts')?.fsPath, '/work/project/src/a.ts');
  assert.equal(
    resolveOpenTarget(roots, directory, 'src\\nested\\a.ts')?.fsPath,
    '/work/project/src/nested/a.ts',
  );
});

check('an absolute path is accepted only inside a root', () => {
  assert.equal(
    resolveOpenTarget(roots, directory, '/work/project/src/a.ts')?.fsPath,
    '/work/project/src/a.ts',
  );
  assert.equal(
    resolveOpenTarget(roots, directory, 'file:///work/project/a.ts'),
    undefined,
    'a file URI is converted by the host wrapper, not here',
  );
  assert.equal(resolveOpenTarget(roots, directory, '/etc/passwd'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, '/work/project-evil/a.ts'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, 'C:/Windows/win.ini'), undefined);
});

check('traversal, schemes and empty values never resolve', () => {
  assert.equal(resolveOpenTarget(roots, directory, '../secrets.txt'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, 'src/../../secrets.txt'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, 'data:text/plain;base64,AAAA'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, 'untitled:Untitled-1'), undefined);
  assert.equal(resolveOpenTarget(roots, directory, ''), undefined);
  assert.equal(resolveOpenTarget(roots, directory, '   '), undefined);
  assert.equal(resolveOpenTarget(roots, directory, '.'), undefined);
  assert.equal(resolveOpenTarget(roots, '', 'src/a.ts'), undefined);
  assert.equal(resolveOpenTarget([], directory, 'src/a.ts'), undefined);
});

check('the attachments root opens the same way as a workspace folder', () => {
  assert.deepEqual(
    resolveOpenTarget(roots, directory, '/home/user/.vscode/attachments/shot.png'),
    { fsPath: '/home/user/.vscode/attachments/shot.png', line: 1 },
  );
});

// openTargetFor: the panel only asks to open a file that exists on disk.
check('an inline image has no open target', () => {
  assert.equal(openTargetFor({ uri: 'data:image/png;base64,AAAA' }), undefined);
  assert.equal(openTargetFor({ uri: 'data:image/png;base64,AAAA', line: 3 }), undefined);
});

check('a file URI is an open target', () => {
  assert.deepEqual(openTargetFor({ uri: 'file:///work/project/a.png', line: 4 }), {
    uri: 'file:///work/project/a.png',
    line: 4,
  });
});

check('a relative path without a URI is an open target', () => {
  assert.deepEqual(openTargetFor({ path: 'src/a.ts' }), { path: 'src/a.ts' });
  assert.deepEqual(openTargetFor({ path: 'src/a.ts', line: 7 }), { path: 'src/a.ts', line: 7 });
});

// normalizeLine: the host clamps the result to the document, never below 1.
check('a line is one-based and never zero', () => {
  assert.equal(normalizeLine(12), 12);
  assert.equal(normalizeLine(12.9), 12);
  assert.equal(normalizeLine(0), 1);
  assert.equal(normalizeLine(-5), 1);
  assert.equal(normalizeLine(Number.NaN), 1);
  assert.equal(normalizeLine(Number.POSITIVE_INFINITY), 1);
  assert.equal(normalizeLine(undefined), 1);
});

if (failures > 0) {
  console.error(`${failures} open-target check(s) failed`);
  process.exit(1);
}
console.log('open target: all checks passed');

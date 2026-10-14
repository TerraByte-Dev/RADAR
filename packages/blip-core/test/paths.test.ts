import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { parseSyncPayload } from '../src/core/sync.js';
import { syncProject } from '../src/io.js';
import { dataDir, mainCheckoutPath, projectId, projectKey, resolveProject } from '../src/paths.js';
import { listProjects, registerProject } from '../src/registry.js';
import { NOW } from './core/fixtures.js';
import { git, isolate, tmp } from './helpers.js';

const V3 = '---\nblip: 3\nname: Sample\n---\n\n# Tasks\n\n- [ ] First task\n';

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A repo with one commit. `tracked` commits a BLIP.md at each given subpath ('' = the root). */
function repo(root: string, tracked: string[] = []): string {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  write(join(root, 'README.md'), 'sample\n');
  write(join(root, 'src', 'deep', 'file.txt'), 'x\n');
  for (const sub of tracked) write(join(root, sub, 'BLIP.md'), V3);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'first');
  return root;
}

describe('resolveProject (spec 5.1)', () => {
  beforeEach(() => {
    isolate();
  });

  it('plain repo: the root, from the root', () => {
    const root = repo(join(tmp(), 'plain'), ['']);
    expect(resolveProject(root)).toBe(root);
  });

  it('subfolder: walks up to the project', () => {
    const root = repo(join(tmp(), 'plain'), ['']);
    expect(resolveProject(join(root, 'src', 'deep'))).toBe(root);
    // A path that does not exist yet (a file about to be written) resolves the same way.
    expect(resolveProject(join(root, 'src', 'not', 'there', 'yet'))).toBe(root);
  });

  it('nested projects: the nearest BLIP.md wins', () => {
    const root = join(tmp(), 'outer');
    write(join(root, 'BLIP.md'), V3);
    write(join(root, 'archive', 'inner', 'BLIP.md'), V3);
    write(join(root, 'archive', 'inner', 'docs', 'note.txt'), 'x');
    expect(resolveProject(join(root, 'archive', 'inner', 'docs'))).toBe(join(root, 'archive', 'inner'));
    expect(resolveProject(join(root, 'archive'))).toBe(root);
  });

  it('linked worktree whose tree has no BLIP.md: the main checkout (BLIP.md is gitignored there)', () => {
    const base = tmp();
    const main = repo(join(base, 'main'));
    write(join(main, 'BLIP.md'), V3);
    git(main, 'worktree', 'add', '-q', '-b', 'feat', join(base, 'wt'));
    expect(resolveProject(join(base, 'wt'))).toBe(main);
    expect(resolveProject(join(base, 'wt', 'src', 'deep'))).toBe(main);
  });

  it('linked worktree whose tree holds a tracked BLIP.md: the main checkout; the copy is never written or registered', async () => {
    const base = tmp();
    const main = repo(join(base, 'main'), ['']);
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    const copy = readFileSync(join(wt, 'BLIP.md'));
    expect(resolveProject(wt)).toBe(main);

    const dir = resolveProject(join(wt, 'src'))!;
    await syncProject(dir, parseSyncPayload({ add: ['Added from the worktree'] }), { author: 'Robin', now: NOW });
    expect(readFileSync(join(main, 'BLIP.md'), 'utf8')).toContain('- [ ] Added from the worktree');
    expect(readFileSync(join(wt, 'BLIP.md')).equals(copy)).toBe(true);

    await expect(registerProject(wt)).rejects.toMatchObject({ code: 'E_WORKTREE' });
    expect((await listProjects()).projects.map((p) => p.dir)).toEqual([main]);
  });

  it('worktree of a monorepo subfolder project: the same subfolder in the main checkout', () => {
    const base = tmp();
    const main = repo(join(base, 'mono'), ['packages/app']);
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    expect(resolveProject(join(wt, 'packages', 'app'))).toBe(join(main, 'packages', 'app'));
    expect(mainCheckoutPath(join(wt, 'packages', 'app'))).toBe(join(main, 'packages', 'app'));
  });

  it('a worktree path with no BLIP.md in the main checkout is no project: there is no fallback to the worktree copy', () => {
    const base = tmp();
    const main = repo(join(base, 'main'));
    const wt = join(base, 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat', wt);
    write(join(wt, 'BLIP.md'), V3);
    expect(resolveProject(wt)).toBeNull();
  });

  it('submodule: not remapped (its .git file has no commondir)', () => {
    const base = tmp();
    const outer = repo(join(base, 'outer'));
    const sub = join(outer, 'vendor', 'lib');
    mkdirSync(join(outer, '.git', 'modules', 'lib'), { recursive: true });
    write(join(sub, '.git'), 'gitdir: ../../.git/modules/lib\n');
    write(join(sub, 'BLIP.md'), V3);
    expect(mainCheckoutPath(sub)).toBeNull();
    expect(resolveProject(sub)).toBe(sub);
  });

  it('worktree of a bare repository: not remapped', () => {
    const base = tmp();
    const src = repo(join(base, 'src'));
    git(base, 'clone', '-q', '--bare', src, 'store.git');
    const wt = join(base, 'wt');
    git(join(base, 'store.git'), 'worktree', 'add', '-q', '-b', 'feat', wt);
    write(join(wt, 'BLIP.md'), V3);
    expect(mainCheckoutPath(wt)).toBeNull();
    expect(resolveProject(wt)).toBe(wt);
  });

  it('non-git folder', () => {
    const root = join(tmp(), 'papers');
    write(join(root, 'BLIP.md'), V3);
    write(join(root, 'drafts', 'a.txt'), 'x');
    expect(resolveProject(join(root, 'drafts'))).toBe(root);
    expect(resolveProject(tmp())).toBeNull();
  });

  it('filesystem root: null, and the walk ends', () => {
    expect(resolveProject(parse(process.cwd()).root)).toBeNull();
  });
});

describe('dataDir and project ids', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('RADAR_BLIP_HOME overrides the platform directory', () => {
    const home = tmp();
    process.env.RADAR_BLIP_HOME = home;
    expect(dataDir()).toBe(home);
  });

  it.runIf(process.platform === 'win32')('Windows: %APPDATA%\\radar-blip, else under the user profile', () => {
    delete process.env.RADAR_BLIP_HOME;
    process.env.APPDATA = 'Z:\\Roaming';
    expect(dataDir()).toBe('Z:\\Roaming\\radar-blip');
    delete process.env.APPDATA;
    process.env.USERPROFILE = 'Z:\\Users\\robin';
    expect(dataDir()).toBe('Z:\\Users\\robin\\AppData\\Roaming\\radar-blip');
  });

  it.runIf(process.platform === 'linux')('Linux: XDG_DATA_HOME, else ~/.local/share', () => {
    delete process.env.RADAR_BLIP_HOME;
    process.env.XDG_DATA_HOME = '/xdg';
    expect(dataDir()).toBe('/xdg/radar-blip');
  });

  it.runIf(process.platform === 'win32')('a \\\\localhost\\C$ spelling of a local folder is the same project', () => {
    const dir = join(tmp(), 'Forms');
    mkdirSync(dir);
    const share = (host: string): string => `\\\\${host}\\${dir[0]}$${dir.slice(2)}`;
    expect(share('localhost')).toMatch(/^\\\\localhost\\[A-Za-z]\$\\/);
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1']) {
      expect(projectKey(share(host))).toBe(projectKey(dir));
      expect(projectKey(`${share(host)}\\`)).toBe(projectKey(dir));
      expect(projectId(share(host))).toBe(projectId(dir));
    }
    // A share on another machine is left as it is.
    expect(projectKey('\\\\fileserver\\c$\\work')).toBe('\\\\fileserver\\c$\\work');
  });

  it('the key ignores a trailing separator, and case where the filesystem does', () => {
    const dir = join(tmp(), 'Mixed Case');
    mkdirSync(dir);
    expect(projectKey(`${dir}${process.platform === 'win32' ? '\\' : '/'}`)).toBe(projectKey(dir));
    if (process.platform === 'win32') {
      expect(projectKey(dir.toUpperCase())).toBe(projectKey(dir.toLowerCase()));
      expect(projectId(dir.toUpperCase())).toBe(projectId(dir));
    }
    expect(projectId(dir)).toMatch(/^[0-9a-f]{12}$/);
  });
});

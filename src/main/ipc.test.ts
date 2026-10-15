import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildBrief, isProjectRecord, listProjects, ownerName, projectId, syncProject } from 'radar-blip'
import { ROUTES, type RouteName } from '../shared/ipc'
import { appInfo } from './ipc'
import { big, bytes, fixture, gitSpy, harness, isolate, project, tmp, v3 } from './testkit'

beforeEach(() => {
  isolate()
})

describe('validation at the IPC boundary', () => {
  // A Record, so a route added to the table without a case here is a type error.
  const malformed: Record<RouteName, unknown> = {
    'projects.list': { extra: 1 },
    'project.edit': { id: 'abc', ops: [] },
    'project.undo': { id: '0123456789ab' },
    'project.setHidden': { id: '0123456789ab', hidden: 'yes' },
    'project.untrack': { id: '../../etc' },
    'project.create': { dir: 'relative/path' },
    'discover.find': { dir: 42 },
    'discover.track': { dirs: 'C:\\x' },
    'activity.refresh': { ids: ['not-an-id'] },
    'system.pickFolder': 'C:\\',
    'system.openExternal': { url: 'file:///C:/Windows/System32/calc.exe' },
    'system.reveal': { path: 'C:\\' },
    'system.openInEditor': { id: '0123456789ab', dir: 'C:\\x' },
    'setup.status': { verbose: true },
    'setup.run': { apply: 'yes' },
    'setup.path': { apply: true, entry: 'C:/elsewhere' },
    'app.info': [1],
    'window.titleBar': { color: 'red', symbolColor: '#A6B3AB' },
    'update.check': { force: true },
    'update.install': 'now'
  }

  it('every route refuses a malformed request with E_BAD_REQUEST before its handler runs', async () => {
    const h = harness()
    const spies = [
      vi.spyOn(h.board, 'ready'),
      vi.spyOn(h.board, 'edit'),
      vi.spyOn(h.board, 'undoEdit'),
      vi.spyOn(h.board, 'setHidden'),
      vi.spyOn(h.board, 'untrack'),
      vi.spyOn(h.board, 'create'),
      vi.spyOn(h.board, 'track'),
      vi.spyOn(h.board, 'refresh'),
      vi.spyOn(h.deps, 'pickFolder'),
      vi.spyOn(h.deps, 'info'),
      vi.spyOn(h.deps.updates, 'check'),
      vi.spyOn(h.deps.updates, 'install'),
      vi.spyOn(h.deps, 'titleBar'),
      vi.spyOn(h.deps.shell, 'openExternal'),
      vi.spyOn(h.deps.shell, 'openPath'),
      vi.spyOn(h.deps.shell, 'showItemInFolder')
    ]
    for (const name of ROUTES) {
      const r = await h.call(name, malformed[name])
      expect(r, name).toMatchObject({ ok: false, error: { code: 'E_BAD_REQUEST' } })
    }
    expect((await h.call('no.such.route')).error.code).toBe('E_BAD_REQUEST')
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  it('an edit op is refused for a position, an unknown key or op, or a value that is not plain data', async () => {
    const h = harness()
    const id = '0123456789ab'
    const bad = [
      { op: 'task.done', task: 0 },
      { op: 'task.done', task: { title: 'A', index: 2 } },
      { op: 'task.move', task: { title: 'A' } },
      { op: 'task.add', title: 'A', position: 1 },
      { op: 'task.delete', task: { title: 'A' } },
      { op: 'set', field: 'deadline', value: '2026-11-01' },
      { op: 'set', field: 'name', value: () => 1 },
      { op: 'set', field: 'now', value: { nested: ['data'] } },
      { op: 'set', field: 'links', value: [{ a: { b: 'c' } }] },
      { op: 'log.add', bullets: 'one' },
      { op: 'task.add', title: 'x'.repeat(4001) }
    ]
    for (const op of bad) expect((await h.call('project.edit', { id, ops: [op] })).error.code, JSON.stringify(op)).toBe('E_BAD_REQUEST')
  })
})

describe('projects.list', () => {
  it('startup answers from files only: every state, activity null, no git process', async () => {
    const ok = await project(fixture('v3/full.md'), 'ok')
    const v2 = await project(fixture('v2/legacy-enums.md'), 'v2')
    const broken = await project(fixture('readonly/broken-yaml.md'), 'broken')
    const newer = await project(fixture('readonly/newer-schema.md'), 'newer')
    const huge = await project(big(), 'huge')
    const gone = await project(v3('Gone'), 'gone')
    rmSync(gone, { recursive: true })
    const git = gitSpy()
    const h = harness({ git })
    const r = await h.call('projects.list')
    expect(r.ok).toBe(true)
    const byDir = Object.fromEntries(r.data.projects.map((p: any) => [p.dir, p]))
    expect(byDir[ok].state).toBe('ok')
    expect(byDir[v2].state).toBe('needs-migrate')
    expect(byDir[broken].state).toBe('needs-repair')
    expect(byDir[broken].doc.name).toBe('broken')
    expect(byDir[broken].doc.problems[0].line).not.toBeNull()
    expect(byDir[newer].state).toBe('needs-repair')
    expect(byDir[huge].state).toBe('ok')
    expect(byDir[gone]).toMatchObject({ state: 'missing', doc: null })
    for (const p of r.data.projects) {
      expect(isProjectRecord(p)).toBe(true)
      expect(p.activity).toBeNull()
      expect(p.id).toBe(projectId(p.dir))
    }
    expect(git.calls).toBe(0)
  })

  it('40 projects, every one listed, without a process', async () => {
    for (let i = 0; i < 40; i++) await project(v3(`Project ${i}`), `p${i}`)
    const git = gitSpy()
    const h = harness({ git })
    const r = await h.call('projects.list')
    expect(r.data.projects).toHaveLength(40)
    expect(r.data.projects.every(isProjectRecord)).toBe(true)
    expect(git.calls).toBe(0)
  })

  it('an empty registry is an empty list', async () => {
    expect((await harness().call('projects.list')).data).toEqual({ projects: [] })
  })
})

describe('writes', () => {
  it('v2, broken and newer files refuse every write with the engine code and stay as they are', async () => {
    const cases: [string, string][] = [
      [fixture('v2/legacy-enums.md'), 'E_NEEDS_MIGRATE'],
      [fixture('readonly/broken-yaml.md'), 'E_UNWRITABLE'],
      [fixture('readonly/newer-schema.md'), 'E_NEWER_SCHEMA']
    ]
    const dirs = []
    for (const [text, code] of cases) dirs.push(await project(text, code))
    const h = harness()
    for (const [i, [, code]] of cases.entries()) {
      const dir = dirs[i]!
      const before = bytes(dir)
      const r = await h.call('project.edit', { id: projectId(dir), ops: [{ op: 'set', field: 'now', value: 'A new line.' }] })
      expect(r.error.code).toBe(code)
      expect(bytes(dir).equals(before)).toBe(true)
    }
  })

  it('a read-only BLIP.md fails the write and keeps its bytes', async () => {
    const dir = await project(v3('Locked'), 'locked')
    const before = bytes(dir)
    chmodSync(join(dir, 'BLIP.md'), 0o444)
    try {
      const r = await harness().call('project.edit', { id: projectId(dir), ops: [{ op: 'set', field: 'now', value: 'A new line.' }] })
      expect(r.ok).toBe(false)
      expect(bytes(dir).equals(before)).toBe(true)
    } finally {
      chmodSync(join(dir, 'BLIP.md'), 0o644)
    }
  })

  it('a validation failure lists every violation', async () => {
    const dir = await project(v3('Valid'), 'valid')
    const r = await harness().call('project.edit', {
      id: projectId(dir),
      ops: [
        { op: 'task.add', title: '- starts like a list item' },
        { op: 'set', field: 'name', value: 'a/b' }
      ]
    })
    expect(r.ok).toBe(false)
    expect(r.error.violations.length).toBeGreaterThanOrEqual(2)
  })

  it('set links: a link in the read model shape reaches doc.links; an oversized or wrong-shaped list never reaches the file', async () => {
    const dir = await project(v3('Linked'), 'linked')
    const id = projectId(dir)
    const h = harness()
    const link = { label: 'Site', url: 'https://example.com' }
    const r = await h.call('project.edit', { id, ops: [{ op: 'set', field: 'links', value: [link, 'https://example.com/docs'] }] })
    expect(r.ok, JSON.stringify(r.error)).toBe(true)
    expect(r.data.record.doc.links).toEqual([link, { label: null, url: 'https://example.com/docs' }])
    const before = bytes(dir)
    const huge = Array.from({ length: 200 }, (_, i) => Object.fromEntries(Array.from({ length: 200 }, (_, k) => [`k${k}`, `${i}`.repeat(300)])))
    for (const value of [huge, [42, true, null, [['a']], { a: { b: 'c' } }], [JSON.parse('{"url":"https://example.com","label":"x","__proto__":{"polluted":1}}')], [{ Site: 'https://example.com' }], ['ftp://example.com/x'], [`https://example.com/${'p'.repeat(2048)}`], Array.from({ length: 21 }, () => 'https://example.com')]) {
      const e = await h.call('project.edit', { id, ops: [{ op: 'set', field: 'links', value }] })
      expect(['E_BAD_REQUEST', 'E_VALUE'], JSON.stringify(value).slice(0, 60)).toContain(e.error?.code)
    }
    expect(bytes(dir).equals(before)).toBe(true)
  })

  it('an id that is not tracked is E_NO_PROJECT', async () => {
    expect((await harness().call('project.edit', { id: '0123456789ab', ops: [{ op: 'task.done', task: { title: 'A' } }] })).error.code).toBe('E_NO_PROJECT')
  })

  it('stale task: an agent removed A → E_TASK_GONE and nothing written; an agent reordered → A and only A is done', async () => {
    const tasks = ['Alpha task one', 'Bravo task two', 'Charlie task three']
    const dir = await project(v3('Stale', tasks), 'stale')
    const dir2 = await project(v3('Moved', tasks), 'moved')
    const h = harness()
    const id = projectId(dir)
    await h.call('projects.list')
    await syncProject(dir, { remove: ['Alpha task one'] }, { author: 'Robin' })
    const after = bytes(dir)
    expect(after.toString()).not.toContain('Alpha task one')
    const r = await h.call('project.edit', { id, ops: [{ op: 'task.done', task: { title: 'Alpha task one' } }] })
    expect(r.error.code).toBe('E_TASK_GONE')
    expect(bytes(dir).equals(after)).toBe(true)

    const id2 = projectId(dir2)
    await syncProject(dir2, { move: [{ ref: 'Charlie task three', to: 'top' }] }, { author: 'Robin' })
    const r2 = await h.call('project.edit', { id: id2, ops: [{ op: 'task.done', task: { title: 'Alpha task one' } }] })
    expect(r2.ok).toBe(true)
    expect(r2.data.record.doc.tasks.open.map((t: any) => t.title)).toEqual(['Charlie task three', 'Bravo task two'])
    expect(r2.data.record.doc.tasks.done.map((t: any) => t.title)).toContain('Alpha task one')
  })
})

describe('undo', () => {
  const OPS: Record<string, unknown[]> = {
    'task.add': [{ op: 'task.add', title: 'Draft the onboarding email', detail: ['One line of detail'], due: '2026-12-01', before: { title: 'Write the release notes for 4.2' } }],
    'task.done': [{ op: 'task.done', task: { title: 'Write the release notes for 4.2' } }],
    'task.reopen': [{ op: 'task.reopen', task: { title: 'Merge the sync engine behind a flag' } }],
    'task.remove': [{ op: 'task.remove', task: { title: 'Renew the signing certificate' } }],
    'task.edit': [{ op: 'task.edit', task: { title: 'Renew the signing certificate' }, title: 'Renew the code signing certificate', detail: ['Replaced detail'], due: null }],
    'task.move': [{ op: 'task.move', task: { title: 'Robin: approve the wording in PR #21' }, before: { title: 'Design the conflict screen so sync can be switched on' } }],
    'set name': [{ op: 'set', field: 'name', value: 'Lantern' }],
    'set now': [{ op: 'set', field: 'now', value: 'Designing the conflict screen.' }],
    'set status': [{ op: 'set', field: 'status', value: 'active' }],
    'set focus': [{ op: 'set', field: 'focus', value: false }],
    'set due': [{ op: 'set', field: 'due', value: null }],
    'set tags': [{ op: 'set', field: 'tags', value: ['product'] }],
    'set links': [{ op: 'set', field: 'links', value: [{ label: 'Site', url: 'https://example.com' }] }],
    'log.add': [{ op: 'log.add', bullets: ['Wrote the onboarding email draft'] }]
  }

  for (const [name, ops] of Object.entries(OPS)) {
    it(`${name}: edit then undo restores the exact bytes`, async () => {
      const dir = await project(fixture('v3/full.md'), 'undo')
      const before = bytes(dir)
      const h = harness()
      const e = await h.call('project.edit', { id: projectId(dir), ops })
      expect(e.ok, JSON.stringify(e.error)).toBe(true)
      expect(e.data.undoToken).toEqual(expect.any(String))
      expect(bytes(dir).equals(before)).toBe(false)
      const u = await h.call('project.undo', { id: projectId(dir), undoToken: e.data.undoToken })
      expect(u.ok).toBe(true)
      expect(bytes(dir).equals(before)).toBe(true)
    })
  }

  it('an edit that also moved a hand-ticked box is undone exactly', async () => {
    const dir = await project(fixture('v3/out-of-place.md'), 'ticked')
    const before = bytes(dir)
    const h = harness()
    const e = await h.call('project.edit', { id: projectId(dir), ops: [{ op: 'task.done', task: { title: 'Port the blog to the new template' } }] })
    expect(e.ok).toBe(true)
    const u = await h.call('project.undo', { id: projectId(dir), undoToken: e.data.undoToken })
    expect(u.ok).toBe(true)
    expect(bytes(dir).equals(before)).toBe(true)
  })

  it('the 83 KB file: edit and undo, exact bytes', async () => {
    const dir = await project(big(), 'big')
    const before = bytes(dir)
    expect(before.length).toBeGreaterThan(80_000)
    const h = harness()
    const first = (await h.call('projects.list')).data.projects[0].doc.tasks.open[0].title
    const e = await h.call('project.edit', { id: projectId(dir), ops: [{ op: 'task.done', task: { title: first } }] })
    expect(e.ok).toBe(true)
    await h.call('project.undo', { id: projectId(dir), undoToken: e.data.undoToken })
    expect(bytes(dir).equals(before)).toBe(true)
  })

  it('after any external write: E_UNDO_STALE and the file is left as it is; a wrong or spent token too', async () => {
    const dir = await project(fixture('v3/full.md'), 'stale-undo')
    const h = harness()
    const id = projectId(dir)
    const e = await h.call('project.edit', { id, ops: [{ op: 'set', field: 'now', value: 'Designing the conflict screen.' }] })
    await syncProject(dir, { log: ['Agent work after the edit'] }, { author: 'Robin' })
    const external = bytes(dir)
    expect((await h.call('project.undo', { id, undoToken: e.data.undoToken })).error.code).toBe('E_UNDO_STALE')
    expect(bytes(dir).equals(external)).toBe(true)

    const e2 = await h.call('project.edit', { id, ops: [{ op: 'set', field: 'now', value: 'Back on the conflict screen.' }] })
    expect((await h.call('project.undo', { id, undoToken: 'not-the-token' })).error.code).toBe('E_UNDO_STALE')
    expect((await h.call('project.undo', { id, undoToken: e2.data.undoToken })).ok).toBe(true)
    expect((await h.call('project.undo', { id, undoToken: e2.data.undoToken })).error.code).toBe('E_UNDO_STALE')
  })

  it('a refused or no-op edit leaves the previous edit undoable', async () => {
    const dir = await project(fixture('v3/full.md'), 'kept-undo')
    const before = bytes(dir)
    const h = harness()
    const id = projectId(dir)
    const e = await h.call('project.edit', { id, ops: [{ op: 'task.done', task: { title: 'Write the release notes for 4.2' } }] })
    expect(e.data.undoToken).toEqual(expect.any(String))
    expect((await h.call('project.edit', { id, ops: [{ op: 'task.done', task: { title: 'No such task here' } }] })).error.code).toBe('E_TASK_GONE')
    expect((await h.call('project.edit', { id, ops: [{ op: 'task.done', task: { title: 'Write the release notes for 4.2' } }] })).data.undoToken).toBeNull()
    expect((await h.call('project.undo', { id, undoToken: e.data.undoToken })).ok).toBe(true)
    expect(bytes(dir).equals(before)).toBe(true)
  })

  it('an edit that changes nothing has no undo token', async () => {
    const dir = await project(fixture('v3/full.md'), 'noop')
    const e = await harness().call('project.edit', { id: projectId(dir), ops: [{ op: 'task.done', task: { title: 'Merge the sync engine behind a flag' } }] })
    expect(e.ok).toBe(true)
    expect(e.data.undoToken).toBeNull()
  })
})

describe('path grants and discovery', () => {
  it('a directory not granted by pickFolder or find is E_FORBIDDEN_PATH on all three directory routes', async () => {
    const dir = await project(v3('Ungranted'), 'ungranted', false)
    const h = harness()
    for (const [name, req] of [
      ['project.create', { dir }],
      ['discover.find', { dir }],
      ['discover.track', { dirs: [dir] }]
    ] as const) {
      expect((await h.call(name, req)).error.code, name).toBe('E_FORBIDDEN_PATH')
    }
    expect((await listProjects()).projects).toHaveLength(0)
  })

  it('find names a file it cannot read after its folder, as projects.list does', async () => {
    const root = tmp()
    for (const [n, text] of [
      ['broken', fixture('readonly/broken-yaml.md')],
      ['newer', fixture('readonly/newer-schema.md')],
      ['legacy', fixture('v2/legacy-enums.md')]
    ]) {
      mkdirSync(join(root, n!))
      writeFileSync(join(root, n!, 'BLIP.md'), text!)
    }
    const h = harness({ pick: root })
    await h.call('system.pickFolder')
    const found = (await h.call('discover.find', { dir: root })).data.found
    const names = Object.fromEntries(found.map((f: any) => [f.dir.split(/[\\/]/).pop(), f.name]))
    expect(names.broken).toBe('broken')
    expect(names.newer).toBe('newer')
    const t = await h.call('discover.track', { dirs: found.map((f: any) => f.dir) })
    for (const r of t.data.projects) expect(names[r.dir.split(/[\\/]/).pop()]).toBe(r.doc.name)
  })

  it('pickFolder grants; find lists names and grants what it found; track puts them on the board', async () => {
    const root = tmp()
    for (const n of ['one', 'two/nested']) {
      const d = join(root, n)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'BLIP.md'), v3(`Found ${n.length}`))
    }
    const h = harness({ pick: root })
    expect((await h.call('system.pickFolder')).data).toEqual({ dir: root })
    const f = await h.call('discover.find', { dir: root })
    expect(f.ok).toBe(true)
    expect(f.data.truncated).toBe(false)
    expect(f.data.found.map((x: any) => x.name).sort()).toEqual(['Found 3', 'Found 10'].sort())
    const t = await h.call('discover.track', { dirs: f.data.found.map((x: any) => x.dir) })
    expect(t.data.projects).toHaveLength(2)
    expect((await h.call('projects.list')).data.projects).toHaveLength(2)
    expect(h.events).toHaveLength(0)
  })

  it('project.create on a folder with a BLIP.md: bytes unchanged, created false; on an empty one: created', async () => {
    const dir = await project(fixture('v3/full.md'), 'adopt', false)
    const before = bytes(dir)
    const h = harness({ pick: dir })
    await h.call('system.pickFolder')
    const r = await h.call('project.create', { dir })
    expect(r.data.created).toBe(false)
    expect(r.data.record.doc.name).toBe('Lantern Notes')
    expect(bytes(dir).equals(before)).toBe(true)

    const empty = tmp()
    const h2 = harness({ pick: empty })
    await h2.call('system.pickFolder')
    const c = await h2.call('project.create', { dir: empty, name: 'Fresh start' })
    expect(c.data.created).toBe(true)
    expect(c.data.record.doc.name).toBe('Fresh start')
    expect(existsSync(join(empty, 'BLIP.md'))).toBe(true)
  })
})

describe('hide, untrack, system', () => {
  it('setHidden flags the record and the registry; untrack only for a missing project', async () => {
    const dir = await project(v3('Hide me'), 'hide')
    const h = harness()
    const id = projectId(dir)
    const r = await h.call('project.setHidden', { id, hidden: true })
    expect(r.data.record.hidden).toBe(true)
    expect((await listProjects()).projects[0]!.hidden).toBe(true)
    expect((await h.call('projects.list')).data.projects[0].hidden).toBe(true)
    expect((await h.call('project.untrack', { id })).error.code).toBe('E_BAD_REQUEST')
    rmSync(dir, { recursive: true })
    const h2 = harness()
    expect((await h2.call('projects.list')).data.projects[0].state).toBe('missing')
    expect((await h2.call('project.untrack', { id })).ok).toBe(true)
    expect((await listProjects()).projects).toHaveLength(0)
  })

  it('openExternal passes http, https and mailto only', async () => {
    const h = harness()
    const open = vi.spyOn(h.deps.shell, 'openExternal')
    for (const url of ['https://example.com', 'http://example.com', 'mailto:a@example.com']) expect((await h.call('system.openExternal', { url })).ok).toBe(true)
    for (const url of ['javascript:alert(1)', 'file:///C:/x', 'ms-settings:']) expect((await h.call('system.openExternal', { url })).error.code).toBe('E_BAD_REQUEST')
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('reveal and openInEditor resolve the id through the registry; with no editor the folder opens', async () => {
    const dir = await project(v3('Reveal'), 'reveal')
    const h = harness()
    const show = vi.spyOn(h.deps.shell, 'showItemInFolder')
    const openPath = vi.spyOn(h.deps.shell, 'openPath')
    await h.call('system.reveal', { id: projectId(dir) })
    expect(show).toHaveBeenCalledWith(join(dir, 'BLIP.md'))
    expect((await h.call('system.openInEditor', { id: projectId(dir) })).data).toEqual({ opened: 'folder' })
    expect(openPath).toHaveBeenCalledWith(dir)
  })
})

describe('app.info', () => {
  it('owner is what brief.owner says on the same machine, and null passes through', async () => {
    const home = tmp('radar-app-gh-')
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Dana Example\n')
    const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
    process.env.HOME = home
    process.env.XDG_CONFIG_HOME = join(home, 'xdg')
    try {
      const dir = await project(v3('Owner'), 'owner')
      const h = harness({ deps: { info: () => appInfo('3.0.0', ownerName()) } })
      const info = await h.call('app.info')
      expect(info.data.owner).toBe('Dana')
      expect(info.data.owner).toBe((await buildBrief(dir)).owner)
      expect(info.data).toMatchObject({ version: '3.0.0', engineVersion: '3.0.0', platform: process.platform })
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
    expect((await appInfo('3.0.0', Promise.resolve(null))).owner).toBeNull()
  })
})

describe('window.titleBar', () => {
  it('hands the two colours to the window', async () => {
    const titleBar = vi.fn()
    const h = harness({ deps: { titleBar } })
    expect(await h.call('window.titleBar', { color: '#050706', symbolColor: '#A6B3AB' })).toMatchObject({ ok: true })
    expect(titleBar).toHaveBeenCalledWith({ color: '#050706', symbolColor: '#A6B3AB' })
  })
})

describe('what the app imports', () => {
  // Spec section 10, renderer: no file under src/ imports chokidar or chrono-node, and neither is in package.json.
  it('no file under src/ imports chokidar or chrono-node, and package.json does not list them', () => {
    const src = join(__dirname, '..')
    const files = readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(ts|tsx|mjs|js)$/.test(e.name))
    expect(files.length).toBeGreaterThan(20)
    for (const f of files) {
      const text = readFileSync(join(f.parentPath, f.name), 'utf8')
      expect(text, f.name).not.toMatch(/from\s+['"](chokidar|chrono-node)['"]|(require|import)\(\s*['"](chokidar|chrono-node)['"]/)
    }
    const pkg = JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8'))
    for (const dep of ['chokidar', 'chrono-node']) expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty(dep)
  })
})

// scripts/demo-data.mjs — the approved placeholder data set as real project folders, for every
// renderer stage's e2e runs and screenshots.
//
//   node scripts/demo-data.mjs --projects <dir> --data <dir> [--home <dir>] [--extra] [--owner Robin]
//
// Run `npm run build:core` first (the registry and the self-check use the built engine).
// Writes, under --projects, one folder per project as <tag>/<slug>: a git repository whose
// commit dates match the mockup's ages (or plain files with those mtimes, or nothing, for the
// "files" and "none" sources), with a v3 BLIP.md; one v2 file (Trail maps), one paused
// project, three archived ones. Under --data, which is the engine data folder (point
// RADAR_BLIP_HOME at it), it writes the registry, a live-session marker for Tidewatch whose
// transcript is touched now (live lasts five minutes: touch demo/tidewatch-session.jsonl again
// to keep it). It writes .gitconfig, which names the owner, into --home (default <data>/demo-home):
// run the app with HOME and USERPROFILE pointing there (the engine reads the owner from git's global config and
// passes no GIT_* variable on), so owner-prefixed steps ("Robin: …") read as the owner's.
// --extra adds the 15 synthetic projects of the 40-project overflow test, among them a file
// that cannot be parsed and a tracked folder that is gone.
//
// The content is the placeholder set behind the public README's screenshots: one invented solo
// developer's side projects, with invented names, steps and log text; nothing in it is taken
// from anyone's real projects. Its shapes (ages, sources, states, sessions) follow the
// radar-design mockup's data set. Both folders must be empty or absent; nothing outside them is
// touched.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: { projects: { type: 'string' }, data: { type: 'string' }, home: { type: 'string' }, extra: { type: 'boolean' }, owner: { type: 'string', default: 'Robin' } }
})
if (!values.projects || !values.data) {
  console.error('usage: node scripts/demo-data.mjs --projects <dir> --data <dir> [--home <dir>] [--extra] [--owner Robin]')
  process.exit(1)
}
const ROOT = resolve(values.projects)
const DATA = resolve(values.data)
const OWNER = values.owner
const GITCONFIG = join(values.home ? resolve(values.home) : join(DATA, 'demo-home'), '.gitconfig')
for (const d of [ROOT, DATA]) {
  if (existsSync(d) && readdirSync(d).length) {
    console.error(`demo-data: ${d} is not empty; give it an empty or new folder`)
    process.exit(1)
  }
}
process.env.RADAR_BLIP_HOME = DATA
const engine = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'blip-core', 'dist', 'index.js')).href)

// ---- the data set: one invented solo developer's projects. `days` = whole days since the last
// work; `behind` = there is work after the last log entry; `you` = the step needs the owner.
const P = [
  { id: 'tidewatch', name: 'Tidewatch', tag: 'apps', focus: 1, live: 1, days: 0, src: 'git', branch: 'feat/widget-view',
    now: 'The harbour picker and the moon-phase strip are merged. The home-screen widget is the open front.',
    next: [
      { t: 'Build the small widget on feat/widget-view', d: ['Start from the four sizes in docs/widget-sizes.md, smallest first.', 'Offline, the widget shows the last cached day; keep its timestamp.'] },
      { t: 'Keep the widget on your lock screen for a day and give notes', you: 1 },
      { t: 'Refresh the bundled harbour list' }] },
  { id: 'lab', name: 'Homelab board', tag: 'home', focus: 1, days: 2, src: 'files',
    now: 'The rack page reads every node now. Disk health and backups sit on one screen.',
    next: [
      { t: 'Build the backup timeline panel on the rack page', d: ['Start from the sketch in docs/backup-panel.md.', 'Three lanes: nightly, weekly, offsite.'] },
      { t: 'Walk the restore drill checklist and tick it through', you: 1 },
      { t: 'Retire the old status page' }] },
  { id: 'boardgame', name: 'Harbor Lantern', tag: 'games', focus: 1, days: 2, src: 'files',
    now: 'The second print-and-play deck is cut. The scoring track still needs a table test.',
    next: [
      { t: 'Play two rounds at the table with the new deck', you: 1, d: ['Notes go in docs/playtest.md; an agent turns them into tasks.'] },
      { t: 'Fold the rulebook down to one sheet' },
      { t: 'Redraw the twelve lantern tiles at print size' }] },
  { id: 'sketchpad', name: 'Sketchpad', tag: 'web', days: 2, src: 'git', branch: 'main', behind: 1,
    now: 'The gallery builds from one folder of scans and is up. Thumbnails are still full size.',
    next: [{ t: 'Generate small thumbnails at build time' }, { t: 'Pick the twelve sketches for the front page', you: 1 }, { t: 'Drop the unused lightbox script' }] },
  { id: 'glide', name: 'Cloud Glide', slug: 'cloud-glide', tag: 'games', days: 3, src: 'git', branch: 'main', behind: 1,
    now: 'The glider and the thermal model are committed and fly well at both frame rates. Wind, terrain and scoring run in parallel.',
    next: [
      { t: 'Stall and spin: lose lift, drop a wing, recover', d: ['Past the critical angle the glider drops a wing. Start with the left one.', '1. Stall: lift falls away above the angle in `flight/tuning.json`.', '2. Spin: yaw builds while the stick stays back.', '3. Recover: let go of `Space`, push forward, then level the wings.'] },
      { t: 'Thermal robustness: a bounded lift table and a test grid', d: ['Clamp climb rate, radius and drift to the ranges in docs/thermals.md.', 'The test grid is 4 wind speeds by 3 glider weights; log any lost flights.'] },
      { t: 'Wind as one seeded field', d: ['The field is computed once per seed; the glider only samples it.'] },
      { t: 'Fly three full runs of the test valley and note any jumps', you: 1 },
      { t: 'Capture a short sunset flight for the devlog', you: 1, due: '2026-11-02', d: ['Use the late-evening preset so the ridge lines read clearly.'] },
      { t: 'Terrain: seed-stable ridges with a minimum valley width', d: ['Same seed, same ridges, at every frame rate.'] },
      { t: 'Scoring: a first pass at distance and landing bonuses' }],
    log: [
      { ago: 3, time: '21:40', who: 'Robin + Claude', b: ['Committed the glider and the thermal model after a run at both frame rates.', 'Split wind, terrain and scoring into parallel branches.'] },
      { ago: 9, time: '15:02', who: 'Robin + Claude', b: ['Rewrote lift to sample the thermal field at both wing tips.', 'Fixed the camera jitter when the glider banks past sixty degrees.'] },
      { ago: 16, time: null, who: 'Robin + Codex', b: ['Added the glider parts list: wings, tail, canopy, ballast.'] },
      { ago: 22, time: null, who: 'Robin', b: ['Drew three valley profiles on graph paper and scanned them.'] }] },
  { id: 'inkwell', name: 'Inkwell', tag: 'type', status: 'blocked', days: 5, src: 'git', branch: 'feat/italic-proof-masters',
    now: 'Version 0.4 of the regular weight is exported. The italic sits in a draft PR, waiting on a printed proof.',
    next: [{ t: 'Mark the spacing on the printed italic proof, then merge PR #52', you: 1 }, { t: 'Merge #49 once the kerning classes are renamed' }, { t: 'Split the glyph set into a core and an extended file' }] },
  { id: 'lichen', name: 'Lichen field guide', tag: 'writing', days: 9, src: 'files', due: '2027-02-01',
    now: 'The 40-page draft builds with every photo credited. It needs your read-through and the licence page.',
    next: [{ t: 'Read the draft and approve the licence page', you: 1 }, { t: 'Write the one-page introduction and send the file to the printer' }, { t: 'After printing: post the free edition', you: 1 }] },
  { id: 'marble', name: 'Marble Racer', tag: 'games', days: 14, src: 'git', branch: 'main', behind: 1, now: null, next: [],
    commitDays: [14, 15, 17, 19, 21, 23, 25, 27, 29] },
  { id: 'looper', name: 'Beat Looper', tag: 'apps', days: 15, src: 'git', branch: 'main',
    now: 'v1.4.0 shipped with tap tempo and a larger pad grid, both built by a friend.',
    next: [{ t: 'Try v1.4.0 live: tap tempo, and pad grids of 4x4, 6x6 and 8x8', you: 1 }, { t: 'Collect feedback on the new dark theme', you: 1 }, { t: 'Metronome drifts while the window is hidden' }] },
  { id: 'linkjar', name: 'Link Jar', tag: 'web', days: 29, src: 'files',
    now: 'Every link imports from one export file now. Tag search is slow on long lists.',
    next: [{ t: 'Find out why tag search slows past a thousand links' }, { t: 'Move the import script into the repo' }, { t: 'Restyle the list view with the new fonts' }] },
  { id: 'teatimer', name: 'Tea Timer', tag: 'tools', days: 36, src: 'git', branch: 'main',
    now: 'Rewritten as a tray app with a softer chime. Nobody has timed a full pot with it yet.',
    next: [{ t: 'Brew three steeps and confirm each chime lands on time', you: 1 }, { t: 'Add a quiet mode that only flashes the tray icon' }, { t: 'Make the steep presets editable' }] },
  { id: 'starmap', name: 'Starmap', tag: 'apps', days: 52, src: 'git', branch: 'feat/constellation-lines', behind: 1,
    now: 'Star catalogue, horizon mask and night mode are built. Offline tiles and an installer are what is left.',
    next: [{ t: 'Pick the five constellations drawn by default', you: 1 }] },
  { id: 'weather', name: 'Backyard weather node', tag: 'home', status: 'blocked', days: 58, src: 'git', branch: 'master',
    now: 'Bench tests closed 11 bugs. The spare humidity sensor has not arrived, so calibration has not started.',
    next: [{ t: 'Order the spare sensor and note the part number', you: 1 }] },
  { id: 'fermento', name: 'Fermento', tag: 'apps', days: 59, src: 'git', branch: 'feat/batch-notes', dirty: 1,
    now: 'The schema is done and batch notes work on their branch. Nothing is backed up yet.',
    next: [{ t: 'Export a backup and push feat/batch-notes' }] },
  { id: 'birdcam', name: 'Bird feed cam', tag: 'home', days: 67, src: 'git', branch: 'main', dirty: 1,
    now: 'The camera board boots and the motion trigger fires. Night shots need a decision.',
    next: [{ t: 'Decide whether night shots use the infrared lamp', you: 1 }] },
  { id: 'radar', name: 'RADAR', tag: 'tools', days: 68, src: 'git', branch: 'main', dirty: 1,
    now: 'The board reads forty projects in under a second. Scope labels still crowd at eighty.',
    next: [{ t: 'Spread the scope labels on the eighty-project set' }] },
  { id: 'movies', name: 'Movie journal', tag: 'web', days: 71, src: 'files',
    now: 'Site is built. No host is set up yet.',
    next: [{ t: 'Set up the host and upload the first ten entries' }] },
  { id: 'starmapsite', name: 'Starmap site', tag: 'web', days: 86, src: 'git', branch: 'main',
    now: 'Landing page rebuilt and building green. It waits on the Starmap installer.',
    next: [{ t: 'Write the download section once the installer exists' }] },
  { id: 'photos', name: 'Photo archive sorter', tag: 'tools', days: 106, src: 'files',
    now: 'Grew from a copy script into a full sorter with dedupe and a dry-run mode.',
    next: [{ t: 'Dry run on the old laptop drive: copy, dedupe, report', you: 1 }] },
  { id: 'yardsale', name: 'Yard sale lister', tag: 'home', days: null, src: 'none', due: '2026-11-18', now: null, next: [] },
  { id: 'dungeon', name: 'Dungeon Dig', tag: 'games', status: 'paused', days: 2, src: 'git', branch: 'main', behind: 1, dirty: 1,
    now: 'Parked on purpose. It still builds, and the first three floors play through.',
    next: [{ t: 'If resumed: redraw the placeholder sprites first', you: 1 }] },
  { id: 'busstop', name: 'Bus Stop', tag: 'apps', status: 'archived', days: 140, src: 'git', now: null, next: [] },
  { id: 'wordduel', name: 'Word Duel', tag: 'games', status: 'archived', days: 210, src: 'git', now: null, next: [] },
  { id: 'choir', name: 'Choir website', tag: 'web', status: 'archived', days: 170, src: 'files', now: null, next: [] },
  // The one v2 file: readable, read-only until `radar-blip migrate` (a v2 file has no Now line).
  { id: 'trailmaps', name: 'Trail maps', tag: 'apps', days: 23, src: 'git', branch: 'main', v2: 1, now: null,
    logLine: 'Tile cache works offline. Elevation shading is next.', next: [{ t: 'Add elevation shading from the open terrain tiles' }] }
]

// Log entries of the cross-project feed, by how many days before the mockup's "today" they were written.
const FEED = {
  tidewatch: [{ ago: 0, time: '14:20', who: 'Robin + Claude', b: ['Merged the harbour picker and the moon-phase strip.', 'Opened feat/widget-view and listed the four widget sizes.'] },
    { ago: 0, time: '09:12', who: 'Robin + Claude', b: ['Fixed the tide curve so it no longer overshoots at slack water.'] }],
  lab: [{ ago: 2, time: '16:48', who: 'Robin + Claude', b: ['Wired the last two nodes into the rack page.', 'Put disk health and backups on one screen.', 'Wrote the restore drill checklist.'] }],
  boardgame: [{ ago: 2, time: '13:05', who: 'Robin + Claude', b: ['Printed and cut the second deck.', 'Trimmed a round from nine phases to six.'] }],
  sketchpad: [{ ago: 2, time: '10:31', who: 'Robin + Codex', b: ['Moved the gallery to a static build and deployed it.'] }],
  dungeon: [{ ago: 2, time: '00:14', who: 'Robin + Claude', b: ['Updated the engine version. The first three floors still play through.'] }],
  inkwell: [{ ago: 5, time: '17:02', who: 'Robin + Claude', b: ['Exported version 0.4 of the regular weight.', 'Put the italic in a draft PR until a printed proof is marked.'] }]
}

// The overflow test's synthetic extras (--extra): [name, days, what is special about it].
const LONG = 'REWRITE THE CHANGELOG PAGE - the page exists but nobody reads it; group the entries by month so the newest sits at the top, then check that every entry links to the release it describes, because last time three links pointed at the draft and readers landed on an empty page. While in there, check the header still shows the right version, that the date format matches the rest of the site, that the screenshots are the 2x files, and that the three oldest entries still make sense to someone who was not there. If grouping by month makes the page too long, fold everything older than a year behind one link and note that in docs/changelog.md so the next person does not undo it. Also decide whether small fixes belong on this page at all or only in the release notes; the current split means the same fix is described in two places with two wordings and nobody reconciles them. Finally, write down who updates the page on release day, add that to the release checklist, and delete the two placeholder entries from June that still sit at the top of the file and confuse everyone who opens it for the first time, then read the whole page aloud once before you call it finished.'
const EXTRA = [
  ['Ledger import', 1, 'long'], ['Docs site', 3], ['Print shop API', 4, 'broken'], ['Field notes', 6], ['Pocket synth', 6.5], ['Type tester', 11], ['Recipe box', 17],
  ['Garage door bot', 33], ['Wedding site', 40, 'gone'], ['Tax helper', 48], ['Old portfolio', 75], ['Chess clock', 95], ['Plant log', 120], ['Game jam 24', 160], ['Dotfiles', 300]
]

// ---- writing

const DAY = 86_400_000
const NOW = new Date()
const pad = (n) => String(n).padStart(2, '0')
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * When a log entry was written. With a clock time (the feed's entries): that time on the day
 * `ago` days back, never later than an hour ago (a "today" entry from a later time of day);
 * with `null` (a date-only heading), that day at 18:00; with no time at all, exactly `ago` days
 * ago, so the board's age is the mockup's.
 */
function at(ago, time, nth = 0) {
  if (time === undefined) return new Date(NOW.getTime() - ago * DAY - nth * 3_600_000 - (NOW.getTime() % 60_000))
  const d = new Date(NOW.getTime() - ago * DAY)
  const [h, m] = (time ?? '18:00').split(':').map(Number)
  d.setHours(h, m, 0, 0)
  const latest = NOW.getTime() - (60 + nth * 60) * 60_000
  return d.getTime() > latest ? new Date(latest - (latest % 60_000)) : d
}

const title = (t) => `${t.you ? `${OWNER}: ` : ''}${t.t}${t.due ? ` (due ${t.due})` : ''}`
const taskLines = (next) => next.flatMap((t) => [`- [ ] ${title(t)}`, ...(t.d ?? []).map((l) => `  ${l}`)])

function blipV3(p, log) {
  const fm = ['---', 'blip: 3', `name: ${p.name}`]
  if (p.now) fm.push(`now: ${JSON.stringify(p.now)}`)
  if (p.status) fm.push(`status: ${p.status}`)
  if (p.focus) fm.push('focus: true')
  if (p.due) fm.push(`due: ${p.due}`)
  fm.push(`tags: [${p.tag}]`, '---', '')
  const body = ['# Tasks', '', ...taskLines(p.next), ...(p.next.length ? [''] : []), '# Session log', '']
  for (const e of log) body.push(`## ${isoDay(e.when)}${e.time === null ? '' : ` ${hhmm(e.when)}`} — ${e.who}`, ...e.b.map((b) => `- ${b}`), '')
  return [...fm, ...body].join('\n')
}

function blipV2(p, log) {
  const e = log[0]
  return ['---', `name: ${p.name}`, 'horizon: this-week', 'status: active', `category: ${p.tag}`, `updated: ${isoDay(e.when)}`, '---', '', '# Tasks', ...taskLines(p.next), '', '# Session log', '', `## ${isoDay(e.when)} — ${e.who}`, ...e.b.map((b) => `- ${b}`), ''].join('\n')
}

const gitEnv = (when) => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_DATE: when.toISOString(),
  GIT_COMMITTER_DATE: when.toISOString()
})
const git = (dir, args, when = NOW) => execFileSync('git', ['-C', dir, ...args], { env: gitEnv(when), stdio: 'pipe' })

function touch(file, text, when) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  utimesSync(file, when, when)
}

/** One project folder. Returns its path. */
function build(p) {
  const dir = join(ROOT, p.tag, p.slug ?? slugOf(p.name))
  mkdirSync(dir, { recursive: true })
  // The log: the feed's entries, the project page's, or one entry on the day of the last work.
  const entries = p.log ?? FEED[p.id] ?? (p.now || p.v2 || p.status === 'archived' ? [{ ago: p.days, who: `${OWNER} + Claude`, b: [p.logLine ?? (p.status === 'archived' ? 'Archived: finished with it.' : p.now.split('. ')[0].replace(/\.?$/, '.'))] }] : [])
  const log = entries.map((e, i) => ({ ...e, who: e.who.replace(/^Robin\b/, OWNER), when: at(e.ago, e.time, i) }))
  // The last work: half an hour after the newest log entry when the log is behind it, else ten
  // minutes before it; with no log, exactly `days` ago.
  const lastLog = log[0]?.when ?? null
  const lastWork = lastLog ? new Date(lastLog.getTime() + (p.behind ? 30 : -10) * 60_000) : at(p.days ?? 0)

  if (p.src === 'git') {
    git(dir, ['init', '-q', '--template=', '-b', p.branch ?? 'main'])
    writeFileSync(join(dir, '.gitignore'), 'BLIP.md\n')
    // Oldest first, so the newest commit is the branch tip.
    const days = (p.commitDays ?? [p.days, p.days + 2, p.days + 5, p.days + 9, p.days + 16, p.days + 30]).slice().sort((a, b) => b - a)
    days.forEach((ago, i) => {
      const when = new Date(lastWork.getTime() - (ago - days[days.length - 1]) * DAY)
      touch(join(dir, 'notes', `step-${i + 1}.md`), `Step ${i + 1} of ${p.name}.\n`, when)
      git(dir, ['add', '-A'], when)
      git(dir, ['commit', '-q', '-m', `Step ${i + 1}`], when)
    })
    if (p.dirty) touch(join(dir, 'notes', 'step-1.md'), 'Edited and not committed yet.\n', new Date(lastWork.getTime() - 5 * 60_000))
  } else if (p.src === 'files') {
    for (const [i, name] of ['README.md', 'docs/plan.md', 'docs/notes.md'].entries()) touch(join(dir, name), `${p.name}: ${name}\n`, new Date(lastWork.getTime() - i * 3 * DAY))
  }
  writeFileSync(join(dir, 'BLIP.md'), p.v2 ? blipV2(p, log) : blipV3(p, log))
  return dir
}

mkdirSync(DATA, { recursive: true })
mkdirSync(dirname(GITCONFIG), { recursive: true })
writeFileSync(GITCONFIG, `[user]\n\tname = ${OWNER}\n\temail = ${slugOf(OWNER)}@example.com\n[commit]\n\tgpgsign = false\n`)

const projects = [...P]
if (values.extra) {
  for (const [name, days, kind] of EXTRA) {
    const p = { id: slugOf(name), name, tag: 'personal', days, src: 'git', branch: 'main', now: 'Synthetic project for the overflow test.', next: [{ t: 'Synthetic next step' }], kind }
    if (kind === 'long') Object.assign(p, { tag: 'tools', src: 'files', now: 'Bank export parses. Categories still need a pass.', next: [{ t: LONG }] })
    if (kind === 'broken') Object.assign(p, { src: 'files' })
    projects.push(p)
  }
}

const dirs = []
for (const p of projects) {
  const dir = build(p)
  if (p.kind === 'broken') {
    // Line 7 is a second mapping on one line: a YAML error the board shows, never repairs.
    writeFileSync(join(dir, 'BLIP.md'), `---\nblip: 3\nname: Print shop API\nnow: Orders post. Refunds are next.\nstatus: active\ntags: [personal]\nlinks: a: b: c\n---\n\n# Tasks\n\n- [ ] Handle refunds\n\n# Session log\n`)
  }
  await engine.registerProject(dir)
  if (p.kind === 'gone') rmSync(dir, { recursive: true, force: true })
  dirs.push({ p, dir })
}

// Tidewatch has a live agent session: a marker whose transcript was written just now.
const live = dirs.find((d) => d.p.live)
if (live) {
  const transcript = join(DATA, 'demo', 'tidewatch-session.jsonl')
  mkdirSync(dirname(transcript), { recursive: true })
  writeFileSync(transcript, '{"type":"user","message":{"role":"user","content":"Build the small widget"}}\n')
  mkdirSync(join(DATA, 'live'), { recursive: true })
  const since = new Date(NOW.getTime() - 30 * 60_000).toISOString()
  writeFileSync(join(DATA, 'live', 'demo-tidewatch.json'), `${JSON.stringify({ sessionId: 'demo-tidewatch', cwd: live.dir, transcriptPath: transcript, startedAt: since, scannedBytes: 0, projects: { [live.dir]: { files: [], committed: false, ran: false, since } } })}\n`)
}

// Self-check: every file reads as intended through the engine.
const bad = []
for (const { p, dir } of dirs) {
  if (p.kind === 'gone') continue
  const doc = engine.parseBlip(readFileSync(join(dir, 'BLIP.md'), 'utf8'), { dirName: dir }).doc()
  const want = p.kind === 'broken' ? 'needs-repair' : p.v2 ? 2 : 3
  const got = doc.problems.some((x) => x.code === 'yaml-invalid') ? 'needs-repair' : doc.schema
  if (got !== want || (want === 3 && doc.name !== p.name)) bad.push(`${dir}: ${got} / ${doc.name}`)
}
if (bad.length) {
  console.error(`demo-data: files that do not read as intended:\n  ${bad.join('\n  ')}`)
  process.exit(1)
}
const { projects: registered } = await engine.listProjects()
console.log(`demo-data: ${dirs.length} projects under ${ROOT}, ${registered.length} registered in ${DATA}`)
console.log(`  run the app with RADAR_BLIP_HOME=${DATA}, and HOME and USERPROFILE set to ${dirname(GITCONFIG)}`)

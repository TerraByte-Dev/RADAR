// The engine's one entry point: what the app builds against. `core/` is pure. The data
// directory and project files are touched by io, atomic, lock, registry and state, by `brief`
// (the payload folder), by the hooks (live markers), by setup (the Claude and Codex config and
// the shim; doctor only reads them), and by the CLI's `sync`, which deletes a used payload
// file. Git runs only through `git.ts`.
export { CAPS, SCHEMA_VERSION, STATUSES, BlipError } from './core/schema.js';
export type { BlipDoc, Task, LogEntry, Problem, BlipStatus, Violation } from './core/schema.js';
export { parseIsoDate } from './core/dates.js';
export { parseBlip, BlipFile } from './core/doc.js';
// The editor is a type only: `file.edit()` is the way in.
export type { BlipEditor, ParseContext, EditableField, ReadOnlyCode } from './core/doc.js';
export type { TaskBlock } from './core/tasks.js';
export { lint } from './core/lint.js';
export { migrateFile } from './core/normalize.js';
export type { MigrationReport } from './core/normalize.js';
export { applyEdit } from './core/edit.js';
export type { EditOp, EditCtx, EditResult, TaskRef, ReportLine, RemovedBlock } from './core/edit.js';
export { parseSyncPayload, syncToOps } from './core/sync.js';
export type { SyncPayload, SyncRef, SyncAdd } from './core/sync.js';

export { BLIP_FILE, blipPath, dataDir, projectId, projectKey, resolveProject } from './paths.js';
export { readProject, updateProject, syncProject, replaceIfRev, migrateProject, initProject } from './io.js';
export type { OpsSource, UpdateResult, ProjectMigration } from './io.js';
export { listProjects, registerProject, setHidden, unregisterProject, findProjects } from './registry.js';
export type { RegisteredProject } from './registry.js';
export { computeActivity } from './activity.js';
export type { Activity } from './activity.js';
export { buildRecord, buildBoard, isProjectRecord } from './board.js';
export type { ProjectRecord, RecordOptions } from './board.js';
export { systemGit } from './git.js';
export type { Git } from './git.js';
export { buildBrief, ownerName } from './brief.js';
export type { Brief } from './brief.js';
export { readLiveMarkers, presenceOf } from './agents/claude/live.js';
export type { AgentPresence, LiveMarker } from './agents/claude/live.js';
export { applySetup, defaultTargets, describePlan, ensure, planSetup } from './setup.js';
export type { SetupPlan, ShimTarget, SkillAction, Targets } from './setup.js';
export { nodeIsOld, runDoctor } from './doctor.js';
export type { Check } from './doctor.js';

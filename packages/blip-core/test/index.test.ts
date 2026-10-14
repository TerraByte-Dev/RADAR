import { describe, it, expect } from 'vitest';
import * as api from '../src/index.js';

describe('the package entry point', () => {
  it('exports the engine surface the app builds against, and none of the internals', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        // core
        'CAPS', 'SCHEMA_VERSION', 'STATUSES', 'BlipError', 'parseIsoDate', 'parseBlip', 'BlipFile', 'lint', 'migrateFile', 'applyEdit', 'parseSyncPayload', 'syncToOps',
        // paths, io, registry
        'BLIP_FILE', 'blipPath', 'dataDir', 'projectId', 'projectKey', 'resolveProject',
        'readProject', 'updateProject', 'syncProject', 'replaceIfRev', 'migrateProject', 'initProject',
        'listProjects', 'registerProject', 'setHidden', 'unregisterProject', 'findProjects',
        // activity, board, brief
        'computeActivity', 'systemGit', 'buildRecord', 'buildBoard', 'isProjectRecord', 'buildBrief', 'ownerName',
        // setup and doctor, for the app's first-run screen and its start-up check
        'planSetup', 'applySetup', 'describePlan', 'ensure', 'defaultTargets', 'runDoctor', 'nodeIsOld',
        // live agent sessions, for the app's poll
        'readLiveMarkers', 'presenceOf',
      ].sort(),
    );
  });
});

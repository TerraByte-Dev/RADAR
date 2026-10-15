// Child process for registry tests: register one project folder.
import { registerProject } from '../../dist/registry.js';

await registerProject(process.argv[2]);

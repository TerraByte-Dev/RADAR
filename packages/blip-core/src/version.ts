import { readFileSync } from 'node:fs';

/**
 * Replaced by the version string where the engine is bundled into one file
 * (`scripts/bundle-cli.mjs`, esbuild `define`), so the bundle never looks for a manifest.
 */
declare const __RADAR_BLIP_VERSION__: string | undefined;

/**
 * This engine's version. In a bundle it is the string injected at bundle time; in the
 * package as built or run from source, the manifest one folder up (`dist/` and `src/` both
 * sit beside `package.json`).
 */
export function engineVersion(): string {
  if (typeof __RADAR_BLIP_VERSION__ === 'string') return __RADAR_BLIP_VERSION__;
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

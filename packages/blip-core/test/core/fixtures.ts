import { readFileSync, readdirSync } from 'node:fs';
import { parseBlip, type BlipFile } from '../../src/core/doc.js';

const ROOT = new URL('../fixtures/', import.meta.url);

/** The exact bytes of a fixture, decoded as UTF-8 (a BOM is kept). */
export function fixture(rel: string): string {
  return readFileSync(new URL(rel, ROOT), 'utf8');
}

/** Every fixture in a folder, as paths relative to `test/fixtures/`. */
export function fixturesIn(dir: string): string[] {
  return readdirSync(new URL(`${dir}/`, ROOT))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `${dir}/${f}`);
}

export function parse(rel: string, mtime?: Date): BlipFile {
  return parseBlip(fixture(rel), mtime ? { dirName: 'sample-folder', mtime } : { dirName: 'sample-folder' });
}

export function parseText(text: string, mtime?: Date): BlipFile {
  return parseBlip(text, mtime ? { dirName: 'sample-folder', mtime } : { dirName: 'sample-folder' });
}

/** A fixed local clock for edits: 2026-10-13 14:05. */
export const NOW = new Date(2026, 9, 13, 14, 5, 0);
export const TODAY = '2026-10-13';

export const V3 = fixturesIn('v3');
export const V2 = fixturesIn('v2');
export const READONLY = fixturesIn('readonly');
export const LINT = fixturesIn('lint');

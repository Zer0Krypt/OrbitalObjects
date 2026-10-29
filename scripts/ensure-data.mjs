#!/usr/bin/env node
// Runs before `npm run dev`: if no catalog has been built yet, try the live
// sources and fall back to the synthetic sample so the app always starts.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'public', 'data', 'catalog.json'))) {
  console.log('[data] No catalog found — fetching live data…');
  const live = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-data.mjs')], { stdio: 'inherit' });
  if (live.status !== 0) {
    console.log('[data] Live fetch failed — generating the offline sample instead.');
    spawnSync(process.execPath, [path.join(root, 'scripts', 'make-sample-data.mjs')], { stdio: 'inherit' });
  }
}

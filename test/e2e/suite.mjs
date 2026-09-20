/** Runs every desktop Obsidian check, or only the checks named on the CLI. */
import { spawnSync } from 'node:child_process';

const desktopChecks = [
  // Popout must start before checks that create and close many split panes.
  'workspace/popout.js',
  'workspace/panes.js',
  'viewport/initial-viewport.js',
  'editing/fidelity.js',
  'editing/keys.js',
  'navigation/bookmarks.js',
  'rendering/colors.js',
  'rendering/root.js',
  'rendering/node-text.js',
  'rendering/drag-rendered-node.js',
  'viewport/zoom.js',
  'viewport/viewport.js',
  'viewport/plugin-reload.js',
  'viewport/async-layout.js',
  'viewport/initial-framing.js',
  'viewport/command-cursor.js',
  'viewport/active-linked-viewport.js',
].map((name) => new URL(name, import.meta.url).pathname);
const checks = process.argv.length > 2 ? process.argv.slice(2) : desktopChecks;
let failed = false;

for (const check of checks) {
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, new URL('run.mjs', import.meta.url).pathname, check],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);

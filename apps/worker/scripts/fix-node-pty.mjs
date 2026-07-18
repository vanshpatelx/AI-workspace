#!/usr/bin/env node
/**
 * node-pty ships prebuilt `spawn-helper` binaries, but package managers
 * (pnpm in particular) can extract them without the executable bit. When that
 * happens every PTY spawn dies with "posix_spawnp failed", which would break
 * the terminal on a fresh install. Restore the bit after install.
 */
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

try {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("node-pty/package.json");
  const prebuilds = join(dirname(pkg), "prebuilds");
  if (!existsSync(prebuilds)) process.exit(0);

  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`[node-pty] chmod +x ${platform}/spawn-helper`);
    }
  }
} catch {
  // node-pty not installed yet, or a platform without spawn-helper (Windows).
}

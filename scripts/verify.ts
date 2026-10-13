// `bun run verify [name ...]`: run the browser checks in scripts/verify/
// (all of them with no names). See docs/agents/verification.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "verify");
const all = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3));
const names = process.argv.slice(2);
const unknown = names.filter((n) => !all.includes(n));
if (unknown.length > 0) {
  console.error(`unknown check(s): ${unknown.join(", ")}. Available: ${all.join(", ")}`);
  process.exit(1);
}

let failed = 0;
for (const name of names.length > 0 ? names : all) {
  const r = Bun.spawnSync(["bun", join(dir, `${name}.ts`)], { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) failed++;
}
process.exit(failed > 0 ? 1 : 0);

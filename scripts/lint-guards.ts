// Rules the linters cannot enforce themselves: no inline escape hatches.
// Oxlint has no `noInlineConfig`, so a disable comment would silence any rule.
// Fix the code instead, or change `.oxlintrc.json` in a reviewed PR.

import { readFileSync } from "node:fs";

const banned = /\b(?:oxlint|eslint)-(?:disable|enable)\b|@ts-(?:ignore|nocheck|expect-error)\b/u;
const roots = ["site/src", "scripts"];
const self = "scripts/lint-guards.ts";

function findEscapeHatches(): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    for (const path of new Bun.Glob(`${root}/**/*.{ts,tsx}`).scanSync(".")) {
      if (path === self) continue;
      hits.push(...matches(path, readFileSync(path, "utf8")));
    }
  }
  return hits;
}

function matches(path: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) => (banned.test(line) ? [`${path}:${String(i + 1)}: ${line.trim()}`] : []));
}

const hits = findEscapeHatches();
if (hits.length > 0) {
  console.error(`lint-guards: ${String(hits.length)} lint/type escape hatch(es) found:\n${hits.join("\n")}`);
  process.exit(1);
}

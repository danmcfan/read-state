import { defineConfig } from "sandworm";

// The Sandcastle pipeline lives in sandworm (github.com/danmcfan/sandworm); this is what is
// particular to read-state. A file in .sandcastle/ named like one of sandworm's prompts replaces it.
export default defineConfig({
  repo: "read-state",
  branch: (issue) => `issue-${issue}-agent`,
  // Every branch is cut from the latest main, as docs/agents/delivery.md asks.
  base: "origin/main",
  keep: ["out"],
  prompts: {
    verify:
      "For any change to `site/`, write and run a verify check (`docs/agents/verification.md`) and look at every screenshot it writes. Commit the check; leave its output in `out/verify/`.",
    reverify: "If a fix touches `site/`, rerun its verify check (`bun run verify <name>`).",
    evidence: "out/verify",
  },
  batch: { workers: 1, mergeBugs: false },
});

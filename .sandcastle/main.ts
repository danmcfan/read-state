import { $ } from "bun";
import {
  branchFor,
  containers,
  describe,
  logsFor,
  outcome,
  runIssue,
  STEPS,
  usageReport,
  type IssueRun,
} from "./pipeline.ts";
import { createTui } from "./tui.ts";

// Run with `bun run sandcastle [issue-number] [--fresh]`. Needs Docker and .sandcastle/.env (copy .env.example).
// With no number it takes the lowest-numbered open ready-for-agent issue. The steps are in
// pipeline.ts; batch.ts runs the same pipeline over a list or range of issues.
//
// The terminal shows a progress view. Ctrl-C stops the agent and removes the container; a second
// Ctrl-C force-removes it and quits. Running the same issue again carries on where it stopped.
const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const issue =
  args.find((arg) => arg !== "--fresh") ??
  (
    await $`gh issue list --label ready-for-agent --state open --json number --jq 'map(.number) | min // empty'`.text()
  ).trim();
if (issue === "") throw new Error("No open ready-for-agent issue; pass an issue number.");

const logs = logsFor(issue);
const runs: IssueRun["runs"] = [];
// The branch is cut from the latest main, as docs/agents/delivery.md asks.
await $`git fetch -q origin main`.quiet();
const tui = createTui(`Sandcastle · issue #${issue} · ${branchFor(issue)}`, STEPS);
let current = "setup";

// Ctrl-C: the first aborts the run so the container is removed; the second removes every
// Sandcastle container this run started and quits at once.
const stop = new AbortController();
const before = new Set(containers());
let interrupts = 0;
const interrupt = (): void => {
  interrupts++;
  if (interrupts === 1) {
    tui.activity("\u001B[33mStopping\u001B[0m: removing the container. Ctrl-C again to force quit.");
    stop.abort(new Error("Interrupted"));
    return;
  }
  const ours = containers().filter((id) => !before.has(id));
  if (ours.length > 0) Bun.spawnSync(["docker", "rm", "-f", ...ours]);
  tui.close([`Force quit during ${current}. Removed ${ours.length} container(s).`]);
  process.exit(130);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  const progress = await runIssue({
    issue,
    fresh,
    reporter: tui,
    signal: stop.signal,
    runs,
    onStep: (step) => {
      current = step;
    },
  });
  tui.close([`${outcome(progress)}: ${progress.url ?? ""}`, `Logs: ${logs}/`, "", ...usageReport(runs)]);
} catch (error) {
  if (!stop.signal.aborted) {
    tui.fail(current, "failed");
    tui.close([`Failed during ${current}: ${describe(error)}`, `Logs: ${logs}/`, "", ...usageReport(runs)]);
    throw error;
  }
  tui.stop(current, "stopped (Ctrl-C)");
  tui.close([
    `Stopped during ${current}; the container is removed.`,
    `Run \`bun run sandcastle ${issue}\` to carry on from ${current}, or add --fresh to start over.`,
    `Logs: ${logs}/`,
    "",
    ...usageReport(runs),
  ]);
  process.exitCode = 130;
}

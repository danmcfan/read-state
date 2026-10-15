import { $ } from "bun";
import { containers, describe, logsFor, outcome, runIssue, usageReport, type IssueRun } from "./pipeline.ts";
import { createBatchTui } from "./tui.ts";

// Run with `bun run sandcastle:batch [issues ...] [--fresh]`, where each argument is a number (`12`)
// or an inclusive range (`10-20`): `bun run sandcastle:batch 10-20 24 31`.
// With no issues it takes every open ready-for-agent issue, oldest first. A named issue that is
// closed, missing, or lacks the ready-for-agent label is skipped.
//
// The issues run one after another through the same pipeline as `bun run sandcastle` (pipeline.ts).
// Each branch is cut from origin/main, so every issue ends as its own PR for the owner to merge;
// one failing issue is reported and the batch moves on to the next.
//
// Ctrl-C stops the agent and removes the container; a second Ctrl-C force-removes it and quits.
// Rerunning carries each issue on from where it stopped, as the single-issue runner does.
const READY = "ready-for-agent";

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const named = [...new Set(args.filter((arg) => arg !== "--fresh").flatMap((arg) => expand(arg)))];

interface Issue {
  number: number;
  state: string;
  labels: { name: string }[];
}
const fetched: unknown[] =
  named.length > 0
    ? await Promise.all(
        named.map(async (n): Promise<unknown> => {
          const view = await $`gh issue view ${n} --json number,state,labels`.nothrow().quiet();
          return view.exitCode === 0 ? view.json() : { number: n, state: "MISSING", labels: [] };
        }),
      )
    : [
        await $`gh issue list --label ${READY} --state open --search sort:created-asc --limit 200 --json number,state,labels`
          .quiet()
          .json(),
      ].flat();
const listed = fetched.filter((value) => isIssue(value));
const runnable = (issue: Issue): boolean => issue.state === "OPEN" && issue.labels.some(({ name }) => name === READY);
const skipped = listed.filter((issue) => !runnable(issue)).map(({ number }) => `#${number}`);
const queue = listed.filter((issue) => runnable(issue)).map(({ number }) => String(number));
if (queue.length === 0)
  throw new Error(`No open ${READY} issues to run${skipped.length > 0 ? ` (skipped ${skipped.join(", ")})` : ""}.`);

const runs: IssueRun["runs"] = [];
const results = new Map<string, string>();
const tui = createBatchTui(
  `Sandcastle batch · ${queue.length} issue(s)`,
  queue.map((issue) => ({ issue, tag: "" })),
);
if (skipped.length > 0) tui.activity(`Skipped, not open and ${READY}: ${skipped.join(", ")}`);

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
  tui.close([`Force quit. Removed ${ours.length} container(s).`, ...report()]);
  process.exit(130);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

async function runOne(issue: string): Promise<void> {
  let current = "setup";
  try {
    // Fetched per issue, so a PR merged while the batch runs is in the next branch's base.
    await $`git fetch -q origin main`.quiet();
    const progress = await runIssue({
      issue,
      fresh,
      reporter: tui.reporter(issue),
      signal: stop.signal,
      runs,
      onStep: (step) => {
        current = step;
      },
    });
    tui.set(issue, "done", "publish", outcome(progress));
    results.set(issue, `${outcome(progress)}: ${progress.url ?? ""}`);
  } catch (error) {
    if (stop.signal.aborted) {
      tui.set(issue, "stopped", current, "stopped (Ctrl-C)");
      results.set(issue, `Stopped during ${current}`);
      return;
    }
    tui.set(issue, "failed", current, "failed");
    results.set(issue, `Failed during ${current}: ${describe(error)}`);
  }
}

/** `12` → [12]; `10-20` → [10, 11, …, 20]. */
function expand(arg: string): number[] {
  const range = /^(\d+)-(\d+)$/u.exec(arg);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from > to) throw new Error(`Range ${arg} runs backwards.`);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  if (/^\d+$/u.test(arg)) return [Number(arg)];
  throw new Error(`Not an issue number or range: ${arg}. Use e.g. 12 or 10-20.`);
}

function isIssue(value: unknown): value is Issue {
  if (typeof value !== "object" || value === null) return false;
  if (!("number" in value) || !("state" in value) || !("labels" in value)) return false;
  const { number, state, labels } = value;
  return (
    typeof number === "number" &&
    typeof state === "string" &&
    Array.isArray(labels) &&
    labels.every((label: unknown) => typeof label === "object" && label !== null && "name" in label)
  );
}

function report(): string[] {
  return [
    ...[...results].map(([issue, result]) => `#${issue}  ${result}  (logs: ${logsFor(issue)}/)`),
    ...(skipped.length > 0 ? [`Skipped, not open and ${READY}: ${skipped.join(", ")}`] : []),
  ];
}

// One issue at a time: the next starts only once the last has its PR.
async function runQueue(): Promise<void> {
  const issue = queue.shift();
  if (issue === undefined || stop.signal.aborted) return;
  await runOne(issue);
  return runQueue();
}

await runQueue();
tui.close([...report(), "", ...usageReport(runs)]);
if (stop.signal.aborted) process.exitCode = 130;

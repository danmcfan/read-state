import { claudeCode, createSandbox, type SandboxRunResult } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { $ } from "bun";
import { cpSync, existsSync, rmSync } from "node:fs";
import type { Tui } from "./tui.ts";

// The pipeline for one issue, shared by main.ts (one issue) and batch.ts (a queue of them).
//
// One container, one branch (issue-<issue>-agent, cut from `base`):
//   implement (Opus) → review and triage (Opus) → fix (Sonnet) → check, refixing up to 3 times → PR body (Sonnet)
// then it pushes the branch and opens the PR. It is a draft if the check is still red.
// A branch with no commits (an audit that only filed issues) gets the PR body as an issue comment instead.
// Each agent's full output goes to .sandcastle/logs/<issue>/.
//
// Running the same issue again skips the steps an earlier run finished (kept in
// .sandcastle/logs/<issue>/state.json) and starts the stopped step over on the same branch.
// `fresh` forgets those and starts from implement; the branch keeps its commits.
const MAX_FIX_ROUNDS = 3;
const OPUS = claudeCode("claude-opus-5-5", { effort: "low" });
const SONNET = claudeCode("claude-sonnet-5-5", { effort: "low" });

export const STEPS = ["setup", "implement", "review", "fix", "check", "pr", "publish"] as const;

/** The parts of the progress view the pipeline drives. */
export type Reporter = Omit<Tui, "close">;

export interface Progress {
  done: string[];
  green?: boolean;
  url?: string;
  // publish found no commits and commented on the issue instead of opening a PR
  commented?: boolean;
}

export interface IssueRun {
  issue: string;
  /** Ref a new branch is cut from. Defaults to origin/main, fetched by the caller. */
  base?: string;
  fresh?: boolean;
  reporter: Reporter;
  /** Aborting it stops the agent and removes the container; runIssue then rejects with its reason. */
  signal: AbortSignal;
  /** Every agent session run, for the usage report. */
  runs: { step: string; result: SandboxRunResult }[];
  /** Called with the step about to run, so a caller can say where a run stopped. */
  onStep?: (step: string) => void;
}

export const branchFor = (issue: string): string => `issue-${issue}-agent`;

export const logsFor = (issue: string): string => `.sandcastle/logs/${issue}`;

export async function runIssue(run: IssueRun): Promise<Progress> {
  const { issue, base = "origin/main", reporter: tui, signal, runs } = run;
  const branch = branchFor(issue);
  const logs = logsFor(issue);
  // Sandcastle removes a clean worktree when the run ends, and out/ is gitignored, so the step
  // outputs (out/pipeline, out/verify) are kept here between runs and put back on the next one.
  const savedOut = `${logs}/out`;
  const stateFile = `${logs}/state.json`;

  if (run.fresh === true) rmSync(savedOut, { recursive: true, force: true });
  const stored: unknown = run.fresh !== true && existsSync(stateFile) ? await Bun.file(stateFile).json() : undefined;
  let progress: Progress = isProgress(stored) ? stored : { done: [] };

  const enter = (name: string): void => {
    run.onStep?.(name);
  };

  // Rejects as soon as the run is aborted, for work that takes no AbortSignal of its own.
  const interruptible = async <T>(work: Promise<T>): Promise<T> => {
    const settled = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(asError(signal.reason));
        signal.addEventListener(
          "abort",
          () => {
            reject(asError(signal.reason));
          },
          { once: true },
        );
      }),
    ]);
    return settled;
  };

  enter("setup");
  tui.start("setup", "container and bun install");
  // Sandcastle adds SIGINT/SIGTERM listeners that remove the container and exit(1) at once,
  // before the caller can close its progress view or say how to carry on. Its exit listener
  // stays, so a crash still removes the container.
  const listening = {
    SIGINT: new Set(process.listeners("SIGINT")),
    SIGTERM: new Set(process.listeners("SIGTERM")),
  };
  const creating = createSandbox({
    branch,
    baseBranch: base,
    sandbox: docker(),
    hooks: { sandbox: { onSandboxReady: [{ command: "bun install --frozen-lockfile" }] } },
  });
  let started: Awaited<typeof creating>;
  try {
    started = await interruptible(creating);
  } catch (error) {
    // Stopped during setup: let the container come up, then remove it.
    const [late] = await Promise.allSettled([creating]);
    if (late?.status === "fulfilled") await late.value.close();
    throw error;
  }
  await using sandbox = started;
  for (const signalName of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signalName)) {
      if (!listening[signalName].has(listener)) process.off(signalName, listener);
    }
  }
  const out = `${sandbox.worktreePath}/out`;
  if (existsSync(savedOut)) cpSync(savedOut, out, { recursive: true, force: false });
  tui.done("setup");

  const record = async (name: string, extra: Omit<Progress, "done"> = {}): Promise<void> => {
    progress = { ...progress, ...extra, done: [...progress.done, name] };
    await Bun.write(stateFile, JSON.stringify(progress, null, 2));
    if (existsSync(out)) cpSync(out, savedOut, { recursive: true, force: true });
  };

  // One pipeline step: skipped if an earlier run finished it, recorded once it is done.
  const phase = async (name: string, note: string, body: () => Promise<void>): Promise<void> => {
    enter(name);
    if (progress.done.includes(name)) {
      tui.skip(name, "done in an earlier run");
      return;
    }
    tui.start(name, note);
    await body();
    tui.done(name);
    await record(name);
  };

  // One agent session, shown under the TUI step `tuiStep`; `name` also names its log file.
  const step = async (
    tuiStep: string,
    name: string,
    agent: typeof OPUS,
    promptFile: string,
    promptArgs: Record<string, string> = {},
  ): Promise<void> => {
    const result = await sandbox.run({
      name,
      agent,
      promptFile: `./.sandcastle/${promptFile}`,
      promptArgs: { ISSUE_NUMBER: issue, ...promptArgs },
      logging: { type: "file", path: `${logs}/${name}.log`, onAgentStreamEvent: tui.event },
      signal,
    });
    for (const { usage } of result.iterations) tui.tokens(tuiStep, usage);
    tui.activity(`${name}: ${result.commits.length} commit(s)`);
    runs.push({ step: `#${issue} ${name}`, result });
  };

  await phase("implement", "Opus", async () => {
    await step("implement", "implement", OPUS, "implement.md");
  });
  await phase("review", "Opus", async () => {
    await step("review", "review", OPUS, "review.md");
  });
  await phase("fix", "Sonnet", async () => {
    await step("fix", "fix", SONNET, "fix.md", {
      TASK: "The review findings are in `out/pipeline/review.md`. If it says `No findings.`, write that to `out/pipeline/fixes.md` and stop.",
    });
  });

  // The fix agent is told to leave the check green; this makes sure, and refixes if not.
  const checkGreen = async (round: number): Promise<boolean> => {
    tui.start("check", round === 1 ? "bun run check" : `bun run check, after fix round ${round - 1}`);
    const check = await interruptible(sandbox.exec("bun run check"));
    if (check.exitCode === 0) return true;
    tui.activity(`\u001B[31mbun run check failed\u001B[0m (round ${round})`);
    if (round > MAX_FIX_ROUNDS) return false;
    // A file, not a prompt arg: prompt args are pasted in before !`...` blocks run.
    await Bun.write(`${out}/pipeline/check.log`, `${check.stdout}\n${check.stderr}`);
    tui.start("check", `fixing, round ${round} of ${MAX_FIX_ROUNDS} (Sonnet)`);
    await step("check", `fix-check-${round}`, SONNET, "fix.md", {
      TASK: "`bun run check` fails; its output is in `out/pipeline/check.log`. Make it pass by fixing the code, never the rules. Each failure is one item; use its tool and file as the id.",
    });
    return checkGreen(round + 1);
  };
  enter("check");
  if (progress.done.includes("check")) tui.skip("check", "done in an earlier run");
  else {
    const green = await checkGreen(1);
    if (green) tui.done("check", "green");
    else tui.fail("check", `red after ${MAX_FIX_ROUNDS} fix rounds; PR will be a draft`);
    await record("check", { green });
  }
  const green = progress.green ?? false;

  await phase("pr", "Sonnet", async () => {
    await step("pr", "pr", SONNET, "pr.md", { CHECK: green ? "passing" : "FAILING" });
  });

  enter("publish");
  if (progress.done.includes("publish")) tui.skip("publish", progress.url ?? "");
  else {
    tui.start("publish", "push and gh pr create");
    const pipeline = `${out}/pipeline`;
    const pr: unknown = await Bun.file(`${pipeline}/pr.json`).json();
    if (!isPrSpec(pr)) throw new Error(`${pipeline}/pr.json is not {"title": string, "attach": string[]}`);
    // An audit can end with only follow-up issues and no commits, and GitHub refuses a PR with no
    // commits, so the PR body goes on the issue as a comment instead.
    const commits = Number((await $`git rev-list --count ${base}..${branch}`.quiet().text()).trim());
    if (commits === 0) {
      const url = (await $`gh issue comment ${issue} --body-file ${pipeline}/pr-body.md`.quiet().text()).trim();
      tui.done("publish", url);
      await record("publish", { url, commented: true });
    } else {
      const attachments = pr.attach.flatMap((path) => ["--attach", path]);
      await $`git push -q -u origin ${branch}`.quiet();
      // A run stopped after gh pr create but before recording it has already opened the PR.
      const existing = (await $`gh pr view ${branch} --json url --jq .url`.nothrow().quiet().text()).trim();
      const draft = green ? [] : ["--draft"];
      const url =
        existing ||
        (
          await $`gh pr create --head ${branch} --title ${pr.title} --body-file ${pipeline}/pr-body.md ${draft} ${attachments}`
            .cwd(sandbox.worktreePath)
            .quiet()
            .text()
        ).trim();
      tui.done("publish", url);
      await record("publish", { url });
    }
  }
  return progress;
}

/** One line saying what a finished run left behind. */
export function outcome(progress: Progress): string {
  if (progress.commented === true) return "No commits, so no PR; the PR body is a comment on the issue";
  return progress.green === true ? "PR" : "Draft PR (check failing)";
}

/** An error's message, with a failed shell command's stderr (a push hook's or gh's reason) appended. */
export function describe(error: unknown): string {
  if (error instanceof $.ShellError) return `${error.message}\n${error.stderr.toString().trim()}`;
  return error instanceof Error ? error.message : String(error);
}

const asError = (reason: unknown): Error => (reason instanceof Error ? reason : new Error("Interrupted"));

export function containers(): string[] {
  const ps = Bun.spawnSync(["docker", "ps", "-q", "--filter", "name=sandcastle-"]);
  return ps.stdout.toString().split("\n").filter(Boolean);
}

export function usageReport(runs: IssueRun["runs"]): string[] {
  return runs.flatMap(({ step: name, result }) =>
    result.iterations.map(({ sessionId, usage }) => {
      const tokens = usage
        ? `in ${usage.inputTokens}, out ${usage.outputTokens}, cache write ${usage.cacheCreationInputTokens}, cache read ${usage.cacheReadInputTokens}`
        : "no usage reported";
      return `${name} (${sessionId ?? "no id"}): ${tokens}`;
    }),
  );
}

function isProgress(value: unknown): value is Progress {
  if (typeof value !== "object" || value === null || !("done" in value)) return false;
  const { done } = value;
  return Array.isArray(done) && done.every((name: unknown) => typeof name === "string");
}

function isPrSpec(value: unknown): value is { title: string; attach: string[] } {
  if (typeof value !== "object" || value === null) return false;
  if (!("title" in value) || !("attach" in value)) return false;
  const { title, attach } = value;
  return (
    typeof title === "string" && Array.isArray(attach) && attach.every((path: unknown) => typeof path === "string")
  );
}

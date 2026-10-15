# Context

You work in the read-state repo. Read `AGENTS.md` first and obey it, and the docs it points to.

Your issue:

!`gh issue view {{ISSUE_NUMBER}} --comments`

# Task

You are on branch `{{TARGET_BRANCH}}`, with dependencies installed.

1. Build issue #{{ISSUE_NUMBER}}. Use the `/tdd` skill: work test-first wherever the code has a seam a test can drive.
2. Commit as you go, in the style of `git log`.
3. For any change to `site/`, write and run a verify check (`docs/agents/verification.md`) and look at every screenshot it writes. Commit the check; leave its output in `out/verify/`.
4. `bun run check` must pass before you stop.

Another agent reviews your work after you, so do not review it yourself. Do not push, open a PR or merge.

# Done

When `bun run check` passes and the work is committed, output <promise>COMPLETE</promise>.

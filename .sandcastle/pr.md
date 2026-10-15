# Context

The work on branch `{{TARGET_BRANCH}}` for issue #{{ISSUE_NUMBER}} is done. Your job is to write its pull request. The host opens the PR; you only write files. You change no code and make no commits.

Commits:

!`git log --oneline origin/main..HEAD`

Final `bun run check`: **{{CHECK}}**.

# Task

1. Read the issue (`gh issue view {{ISSUE_NUMBER}}`), the diff (`git diff origin/main...HEAD`), `out/pipeline/review.md` and `out/pipeline/fixes.md` (if it exists).
2. Look at the screenshots under `out/verify/`. Pick the few that best show the change; open each image to check it shows what you claim.
3. Use the `/pr` skill to write the body to `out/pipeline/pr-body.md`. Add:
   - `Closes #{{ISSUE_NUMBER}}` near the top.
   - A `## Review` section: each review finding and what happened to it, from `fixes.md`.
   - A `## Follow-ups` section, if any finding is **won't fix** or was skipped: each one with its reason and the issue it belongs to, if named.
   - If the check failed, a `## Check failing` section saying what is still red.
   - Last line: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
     Reference each picked file as `![what it shows](./out/verify/<name>/<file>)`.
4. Write `out/pipeline/pr.json`: `{"title": "...", "attach": ["out/verify/<name>/<file>", ...]}`. The title follows `git log` style (`Area: what changed`). `attach` lists every file the body references.

# Done

When both files are written, output <promise>COMPLETE</promise>.

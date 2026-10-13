# Delivery: branch, PR, hand off

Every change ships as a pull request that the repo owner reviews and merges on GitHub. Finish each piece of work as an **open PR**: that is the definition of done. The owner merges it.

## Steps

1. **Branch** from an up-to-date `main`: `git switch -c issue-<number>-<slug>` (e.g. `issue-21-remove-harness`), or a short slug when there is no issue.
2. **Build it.** Commit as you go, with messages in the style of `git log`.
3. **Gate**: `bun run check` passes (`docs/agents/quality-gate.md`). For a change to `site/`, `bun run verify` passes too, and its screenshots go in the PR (`docs/agents/verification.md`).
4. **Push** the branch and **open the PR**:

   ```sh
   git push -u origin HEAD
   gh pr create --title "..." --body-file <body.md>
   ```

   - The body follows the `/pr` skill.
   - Include `Closes #<n>` for each issue it finishes.

5. **Follow-ups** (review comments, more changes): commit to the same branch and push.

## Boundaries

- Work reaches `main` only through a PR the owner merges. Leave `gh pr merge` and pushes to `main` to the owner, even when asked to "push" (push the branch and update the PR).

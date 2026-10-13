# Quality gate

`bun run check` must pass before a push (the pre-push hook runs it) and in CI (`.github/workflows/ci.yml`). It runs, in order:

| Step        | Command                | Enforces                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types       | `bun run typecheck`    | `tsconfig.json`: `strict` plus `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `erasableSyntaxOnly`, no unused locals or parameters.                                                                                                                                    |
| Lint        | `bun run lint`         | `.oxlintrc.json`, type-aware: the correctness, suspicious, pedantic and perf categories as errors, plus jsx-a11y; no `as` casts (except `as const`), no `!`, no `any`; explicit return types; no floating promises. `scripts/lint-guards.ts` rejects `oxlint-disable`/`eslint-disable` and `@ts-ignore`-style comments. |
| Format      | `bun run format:check` | Prettier, `printWidth` 120. `bun run format` fixes it.                                                                                                                                                                                                                                                                  |
| Unused code | `bun run knip`         | No unused files, exports or dependencies.                                                                                                                                                                                                                                                                               |
| Tests       | `bun test`             | `site/src/*.test.ts`, including the WASM builds loaded under Bun.                                                                                                                                                                                                                                                       |
| Build       | `bun run build`        | The site bundles into `dist/`.                                                                                                                                                                                                                                                                                          |
| Native      | `bun run test:native`  | `go vet`, `go test` and `cargo test`.                                                                                                                                                                                                                                                                                   |

The pre-commit hook formats and lint-fixes the staged files, so most findings are fixed before they reach the gate. `bun install` installs both hooks.

Browser checks (`bun run verify`) are not in the gate: they need agent-browser and a local Chrome. Run them for any change to `site/` (`docs/agents/verification.md`).

## Fix the code, not the rules

A finding is fixed in the code: replace a cast with a type guard (`isRecord` and friends in `site/src/live.ts`), a `!` with a check that throws. If a rule is wrong for this repo, say so in the PR and change `.oxlintrc.json` there, with the reason in the PR body. Two rules are off for that reason: `jsx-a11y/prefer-tag-over-role` (`role="img"` is right on an `<svg>`) and `unicorn/require-post-message-target-origin` (every `postMessage` here goes to or from a Worker).

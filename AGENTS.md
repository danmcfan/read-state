# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `danmcfan/read-state`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Site

Vite + SolidJS + strict TypeScript, run by Bun (`docs/adr/0001-site-on-vite-solid-typescript.md`). Gate: `bun run check` (`docs/agents/quality-gate.md`). Browser checks for any `site/` change: `bun run verify` (`docs/agents/verification.md`).

## Delivery

Every change ships as a PR from its own branch; the owner reviews and merges on GitHub. Steps and boundaries: `docs/agents/delivery.md`.

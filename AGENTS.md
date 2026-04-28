# AGENTS.md

## Requirement Preservation

- Never change, narrow, reinterpret, or partially satisfy the user's explicit requirements without asking first. If the request is expensive, slow, risky, or ambiguous, preserve the requested scope and ask before changing counts, filters, copy modes, launch configs, defaults, reward weights, checkpoint sources, or other operational details.

## Purpose

- Define repository-specific instructions for coding agents.
- Keep guidance concrete: exact commands, paths, and constraints.
- Keep this file current when commands or conventions change.

## Repository Snapshot

- Project: `sora-creator-tools`
- Primary stack: `Chrome Extension (Manifest V3) + vanilla JavaScript + Node.js built-in test runner`
- Key entry points: `manifest.json`, `content.js`, `inject.js`, `dashboard.js`, `background.js`

## Commands

- Install dependencies (tooling only): `node --version && npm --version`
- Start development environment:
  - `open -a "Google Chrome" "chrome://extensions"`
  - In Chrome, enable Developer mode and Load unpacked from `/sora-creator-tools`
- Build production artifact (release zip): `rm -f release.zip && zip -r release.zip manifest.json *.js *.html *.css icons imagery -x "*.DS_Store"`
- Run tests: `node --test tests/*.test.js`
- Run JavaScript syntax checks: `for f in *.js tests/*.js; do node --check "$f"; done`
- Run whitespace/error check before commit: `git diff --check`

## Workflow Rules

- Read this file before making edits.
- Keep changes scoped to the user request; avoid opportunistic refactors.
- Do not change extension permissions, host matches, or injected network hooks unless requested.
- Preserve local-first behavior: do not add new external network calls. Existing network activity must remain limited to the current Sora/OpenAI endpoints already used by the project.
- Ask before destructive actions (mass deletes, history rewrites, resets).
- Run relevant verification commands before finalizing changes.

## Pull Request Expectations

- Summarize behavior changes and impacted files.
- Include verification commands run and key outcomes.
- Include screenshots or short recordings for dashboard/UI changes.
- Call out known risks, assumptions, or follow-up work.

## Monorepo Notes

- This repository is not a monorepo.
- Add nested `AGENTS.md` files only if a subdirectory later needs different rules.

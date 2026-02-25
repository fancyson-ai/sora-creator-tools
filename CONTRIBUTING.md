# Contributing

Thanks for contributing to `sora-creator-tools`.

By participating, you agree to:
- The repository license terms ([LICENSE](./LICENSE))
- The Developer Certificate of Origin (DCO 1.1) in this file

## Repository basics

This project is a Chrome extension (Manifest V3) using vanilla JavaScript.

Key files:
- `manifest.json`
- `content.js`
- `inject.js`
- `background.js`
- `dashboard.js`

## Development setup

Prerequisites (tooling only):

```bash
node --version && npm --version
```

Load unpacked extension in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Local validation before PR

Run these commands before opening a PR:

```bash
node --test tests/*.test.js
for f in *.js tests/*.js; do node --check "$f"; done
git diff --check
```

Optional release artifact build:

```bash
rm -f release.zip && zip -r release.zip manifest.json *.js *.html *.css icons imagery -x "*.DS_Store"
```

## Scope and expectations

- Keep changes scoped to the issue/request; avoid opportunistic refactors.
- Do not broaden extension permissions, host matches, or injected network hooks unless explicitly required.
- Preserve local-first behavior (no new external network calls unless clearly justified).
- Document any new setup/test steps in README if workflow changes.

## Pull request checklist

Include the following in your PR:
- Clear summary of behavior changes
- List of impacted files
- Validation commands run and key outcomes
- Screenshots or short recordings for dashboard/UI changes
- Known risks, assumptions, or follow-up work

## Developer Certificate of Origin (DCO 1.1)

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file; or
(b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an appropriate open source license and I have the right under that license to submit that work with modifications, whether created in whole or in part by me, under the same open source license (unless I am permitted to submit under a different license), as indicated in the file; or
(c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I have not modified it.

I understand and agree that this project and the contribution are public and that a record of the contribution (including all personal information I submit with it, including my sign-off) is maintained indefinitely and may be redistributed consistent with this project or the open source license(s) involved.

## DCO sign-off

Include a `Signed-off-by` line in each commit message:

```text
Signed-off-by: Your Name <you@example.com>
```

Recommended:

```bash
git commit -s -m "Your commit message"
```

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Add to Chrome](https://img.shields.io/badge/Chrome%20Extension-Add%20Now-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/sora-creator-tools-%E2%80%93-sora/nijonhldjpdanckbnkjgifghnkekmljk)

<p>
  <strong>🧡 Supported by Our Sponsors</strong><br>
  <a href="https://sorastats.com">
    <img src="/imagery/Sorastat-logo.png" alt="SoraStats Sponsor" width="187">
  </a>
</p>

# Sora Creator Tools

Chrome extension for `https://sora.chatgpt.com/*` that adds Sora feed overlays, gather/analyze tools, an advanced drafts workflow (`/uv-drafts`), and a local analytics dashboard.
Unofficial community extension. Not affiliated with, endorsed by, or sponsored by OpenAI. "Sora" is a trademark of OpenAI.

![](/imagery/extension1.jpg)
![](/imagery/extension2.jpg)
![](/imagery/extension5.webp)

## What It Does

- Adds post overlays on Explore/Profile/Post pages (views, unique viewers, interaction metrics, remix metrics, duration).
- Adds feed controls including filtering, Gather mode, and Analyze mode on Top feed.
- Captures metrics snapshots locally while you browse.
- Provides a full dashboard (`dashboard.html`) with charts, compare mode, post filters, import/export, and data purge tools.
- Adds a dedicated `/uv-drafts` page with:
  - Draft caching and progressive sync
  - Pending task polling
  - Bookmarking, filtering, search, and workspace management
  - Fast draft actions (open, download, copy prompt, post, schedule)
  - Composer tools (model/orientation/resolution/style/seed/duration/gens)

## Detailed Features

### Feed + Post Enhancements

- **Post View Counts**: Shows unique viewers and total views on Explore cards, profile grids, and post detail pages.
- **Interaction Metrics**: Surfaces likes, comments/replies, interaction rate, and recursive remix counts directly in overlays.
- **Hotness Labels**: Applies age-based visual badges (red to yellow gradient) so very recent/high-velocity posts are easy to spot.
- **Super-Hot Indicator**: Highlights fast-breaking posts (high likes in low elapsed time) with stronger visual treatment.
- **Best Posting Time Cue**: Marks cards posted near recurring high-performing windows based on gathered history.
- **Quick Feed Filters**: One-click age filters (`<3h` ... `<21h`) plus a **No Remixes** filter.

### Gather Mode

- Available on Top feed and profile pages.
- Auto-scroll + periodic refresh to keep collecting snapshots in the background.
- Designed to accumulate local metrics without external telemetry.
- Can run in a dedicated window for longer uninterrupted collection.

### Analyze Mode (Top Feed)

- In-page analysis table with sortable columns (views, likes, remixes, comments, age, efficiency metrics).
- Fast initial data burst plus ongoing refresh so the table stays current while browsing.
- Works with gathered local history to provide richer top-feed insights over time.

### Dashboard Mode (Extension Icon)

- Opens `dashboard.html` in its own tab (reused/focused if already open).
- Type-ahead profile picker with quick post visibility controls (show/hide all, top/bottom slices, stale, date windows).
- Per-profile metric cards for views, unique viewers, likes, replies, recursive remixes, engagements, cast-in, and followers.
- Multi-chart analytics for:
  - Interaction Rate vs. Views/Viewers
  - Views over Time
  - Views Per Person over Time
  - Followers over Time
  - Compare-mode aggregate charts across selected creators
- Linear + stacked chart modes with adjustable time windows.
- Compare mode with multi-user pills and aggregate totals.
- CSV import/export and data cleanup actions from the dashboard data menu.

### UV Drafts (`/uv-drafts`)

- Local draft cache with progressive sync and pending-task polling.
- Bookmarking, search, custom filters, and workspace-aware organization.
- Fast actions (open, download, copy prompt, post/schedule).
- Composer helpers (model/orientation/resolution/style/seed/duration/gens) with override support.

## Architecture

### Manifest + Runtime

- Manifest: [manifest.json](./manifest.json)
- Content script: [content.js](./content.js)
- Injected page scripts: [api.js](./api.js) and [inject.js](./inject.js) load on Sora pages; [uv-drafts-logic.js](./uv-drafts-logic.js) + [uv-drafts-page.js](./uv-drafts-page.js) are loaded on demand for `/uv-drafts`
- Background service worker: [background.js](./background.js)
- Dashboard UI: [dashboard.html](./dashboard.html), [dashboard.js](./dashboard.js), [dashboard.css](./dashboard.css), [theme.js](./theme.js)

### Data Flow (High Level)

1. `inject.js` intercepts relevant Sora feed/profile/post API responses in page context.
2. It normalizes and batches metrics, then posts them to `content.js`.
3. `content.js` relays batches to `background.js`.
4. `background.js` is the single writer for metrics state in `chrome.storage.local`.
5. Dashboard requests metrics through content/background message bridges, and hydrates deeper history from cold snapshot shards when needed.

Cross-context bridge notes:

- Page↔extension messages are schema-validated and scope-limited (`analyze`/`post` requests only).
- Dashboard open actions reuse/focus an existing dashboard tab when one is already open.

### Storage Model

- Local-first only (`chrome.storage.local`, `localStorage`, and IndexedDB for `/uv-drafts`).
- Metrics hot/cold split:
  - Hot key: latest-per-post metrics in `metrics`
  - Cold keys: historical snapshots by user under `snapshots_<userKey>`
- Includes migration logic (`metricsStorageVersion`) for older monolithic storage.

## Privacy

- No external analytics/telemetry endpoints are introduced by this extension.
- Metrics and preferences stay on-device in browser storage.
- Network requests made by extension features are scoped to Sora endpoints under `https://sora.chatgpt.com/*`.
- The extension message bridge validates payload shape and sender scope before processing metrics actions.

## Install

### Chrome Web Store

- [Install from Chrome Web Store](https://chromewebstore.google.com/detail/sora-creator-tools-%E2%80%93-sora/nijonhldjpdanckbnkjgifghnkekmljk)

### Local Unpacked (Development)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select:
   - `/sora-creator-tools`

## Development

### Prerequisites

- Node.js + npm (tooling only)

```bash
node --version && npm --version
```

### Run tests

```bash
node --test tests/*.test.js
```

### Run syntax checks

```bash
for f in *.js tests/*.js; do node --check "$f"; done
```

### Whitespace/error check before commit

```bash
git diff --check
```

### Build release zip

```bash
rm -f release.zip && zip -r release.zip manifest.json *.js *.html *.css icons imagery -x "*.DS_Store"
```

## Testing Status

Current repository test suite (Node built-in test runner):

- `87` tests
- `87` passing
- `0` failing

Primary coverage currently targets dashboard regressions and shared UV drafts logic.

## Project Layout

- [manifest.json](./manifest.json): MV3 config and permissions
- [content.js](./content.js): bridge between page scripts and extension runtime
- [inject.js](./inject.js): feed UI overlays + gather/analyze + runtime integration
- [api.js](./api.js): composer/network patching and duration/gen controls
- [uv-drafts-page.js](./uv-drafts-page.js): `/uv-drafts` page module and workflows
- [uv-drafts-logic.js](./uv-drafts-logic.js): shared pure logic for runtime/tests
- [background.js](./background.js): metrics persistence/cache/index/migration
- [dashboard.html](./dashboard.html), [dashboard.js](./dashboard.js), [dashboard.css](./dashboard.css), [theme.js](./theme.js): dashboard UI and analytics
- `tests/*.test.js`: regression and unit/integration tests

## Notes

- Keep a dedicated window/tab for Gather mode if you want long-running collection without tab sleeping.
- Reload the extension in `chrome://extensions` after local code changes.
- Clearing extension/site storage removes captured analytics history.

## Contributing

Contributions are accepted under the DCO. See [CONTRIBUTING.md](./CONTRIBUTING.md).
Contributor attribution is tracked in [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

MIT. See [LICENSE](./LICENSE).

## More Visuals

![](/imagery/extension3.jpg)
![](/imagery/extension4.jpg)

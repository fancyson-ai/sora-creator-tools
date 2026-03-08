[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Add to Chrome](https://img.shields.io/badge/Chrome%20Extension-Add%20Now-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/sora-creator-tools-%E2%80%93-sora/nijonhldjpdanckbnkjgifghnkekmljk)

<p>
  <strong>Supported by Our Sponsors</strong><br>
  <a href="https://sorastats.com">
    <img src="/imagery/Sorastat-logo.png" alt="SoraStats Sponsor" width="187">
  </a>
</p>

# Sora Creator Tools

Chrome extension for `https://sora.chatgpt.com/*` that adds four major product surfaces on top of Sora:

- Feed and post overlays for views, interaction ratios, remix signals, heat, duration, and creator metadata
- Runtime controls for filtering, Gather, Analyze, Harvest, and native Drafts queue bridging
- **Creator Tools**, an extension-owned advanced drafts workflow at `/creatortools`
- A local analytics dashboard at `dashboard.html` with metrics, compare mode, and a Harvest record browser

Creator Tools is the canonical name for the advanced drafts surface, mounted at `/creatortools`.

Unofficial community extension. Not affiliated with, endorsed by, or sponsored by OpenAI. "Sora" is a trademark of OpenAI.

![](/imagery/extension1.jpg)
![](/imagery/extension2.jpg)
![](/imagery/extension5.webp)

## Table of Contents

- [What It Does](#what-it-does)
- [Detailed Features](#detailed-features)
- [Architecture](#architecture)
- [Privacy](#privacy)
- [Install](#install)
- [Development](#development)
- [Testing Status](#testing-status)
- [Project Layout](#project-layout)
- [Notes](#notes)
- [Contributing](#contributing)
- [License](#license)

## What It Does

- **Feed + post overlays**: adds inline metrics and metadata on Explore, Profile, Post, and Draft detail surfaces so you can see what is performing without opening the dashboard.
- **Runtime controls**: adds filter, Gather, Analyze, and Harvest controls directly on Sora pages, plus a queue bridge on native `/drafts`.
- **Creator Tools (`/creatortools`)**: adds a dedicated extension-owned drafting workspace with local caching, workspaces, batch prompt queues, scheduling, and fast draft actions.
- **Dashboard (`dashboard.html`)**: provides on-device analytics, compare mode, multiple chart families, Harvest browsing, import/export utilities, and purge tooling.

## Detailed Features

### Feed + Post Enhancements

- **View metrics in-place**: overlays show unique viewers, total views, likes, comments/replies, recursive remixes, and derived interaction metrics on Explore cards, profile grids, and post detail pages.
- **Current metric pills**:
  - `👀 X` unique views with tooltip support for total views and views per person
  - `X% IR` interaction rate from likes/comments relative to unique viewers
  - `X% RR` remix rate relative to likes
  - age/heat token with the current recency state
  - duration badge such as `10s`
- **Remix indicator behavior**:
  - remix posts and remix drafts get a leading icon-only remix pill
  - source post links resolve to `/p/<id>` when the parent is a published post
  - source draft links resolve to `/d/<id>` when the seed is another draft
  - when the source is missing, the pill remains visible but disabled instead of pretending there is no remix context
- **Duration and model cues**: duration pills derive timing from live payloads and stored snapshots, and tooltips infer the likely model tier where possible.
- **Heat / hotness badges**: recent, high-velocity posts are color-coded so very fresh, very hot, and merely recent items are visually distinct.
- **Super-hot treatment**: fast-moving posts can receive stronger styling when engagement accumulation is unusually high for their age.
- **Best posting time cue**: posts can be flagged when they land near historically strong time windows from your own gathered dataset.
- **Quick feed filters**: one-click recency filters (`<3h`, `<6h`, `<12h`, `<15h`, `<18h`, `<21h`) plus a dedicated **No Remixes** filter.
- **Draft/detail overlays**: draft detail pages and remix flows reuse the same remix-source and duration cue logic so draft and published surfaces stay consistent.
- **Character and creator enhancements**:
  - tracks cast/cameo usernames when available
  - decorates character/profile surfaces with cameo counts, likes received, and can-cameo state
  - supports character sorting modes such as date, likes, cameos, and likes-per-day

### Runtime Controls on Sora Pages

#### Filter

- Available on feed surfaces where overlay filtering is useful.
- Preserves the selected filter state in session storage for the current tab/session.
- Hides or narrows the visible set without requiring a dashboard round trip.

#### Gather

- Available on Top feed and profile pages.
- Auto-scrolls and periodically refreshes the page so metrics snapshots keep accumulating while you browse.
- Designed for long-running local collection, including dedicated-window usage when you want the tab to stay active.
- Supports URL entry via `?gather=1` on supported routes.

#### Analyze

- In-page analysis table focused on Top feed workflows.
- Sortable across views, likes, remixes, comments, interaction metrics, age, and duration.
- Uses live page data plus stored metrics history, then keeps refreshing on an interval.
- Supports cameo/person filtering so you can inspect posts tied to a specific creator or cast member.
- Marks visited rows and can run an initial burst gather to populate a useful first table quickly.

#### Harvest

- Available on Top feed, profile pages, and native `/drafts`.
- Starts from API-first pagination when the required request template can be captured.
- Falls back to bounded DOM harvesting when the API path is unavailable or incomplete.
- Captures a dedicated Harvest dataset separate from the hot metrics cache.
- Preserves prompt/detail metadata where available so the dashboard Harvest browser can inspect it later.

#### Native Drafts Queue Panel

- Native `/drafts` gains a queue panel that bridges into Creator Tools.
- The panel provides:
  - **Open Creator Tools** to enter the extension-owned drafting surface
  - **Resume Queue** when a paused batch exists
  - queue state, retry countdowns, and retry pushback controls
- This lets the native drafts page act as the operational handoff point for queued batch creation without making `/drafts` itself the primary advanced workflow.

### Creator Tools (`/creatortools`)

Creator Tools is the extension-owned advanced drafts workflow. It is loaded lazily only when the route matches `/creatortools`.

#### Route and access model

- Canonical route: `/creatortools`
- Access paths:
  - direct navigation to `/creatortools`
  - sidebar **Creator Tools** button
  - native `/drafts` queue panel bridge

#### Local cache and sync behavior

- Drafts are cached locally in IndexedDB for fast startup and incremental refresh.
- The first visible render comes from local cache when possible, then newer API data progressively merges in.
- Pending tasks are polled from `https://sora.chatgpt.com/backend/nf/pending/v2` so in-flight generations can appear before they fully settle into the normal drafts listing.
- Cache freshness and sync progress are persisted locally so reloads can resume a partial session instead of starting from zero.
- The page keeps separate handling for:
  - stored draft metadata
  - cached thumbnails
  - cached preview videos
  - workspaces
  - scheduled posts
  - seen-draft tracking
  - sync-state metadata

#### Search, filtering, and organization

- Built-in filter states include:
  - `all`
  - `bookmarked`
  - `hidden`
  - `violations`
  - `new`
  - `unsynced`
- Search supports free text plus structured key/value filtering across fields such as:
  - `id`
  - `task`
  - `workspace`
  - `model`
  - `orientation`
  - `title`
  - `prompt`
  - `duration`
  - `resolution`
  - `style`
  - `seed`
  - bookmark/new/hidden booleans
- Workspace filtering is first-class and persists in the local view state.
- Bookmarking and hidden-state management work alongside workspace assignment rather than replacing it.
- Unread/new logic is based on seen-draft tracking plus read state, with special handling so pending and unsynced drafts do not get mislabeled as new.
- **Mark All Read** is persisted and retry-aware:
  - read marks queue locally
  - failed sync attempts are tracked as unsynced
  - retry progress survives refreshes

#### Workspaces

- User-created workspaces live in IndexedDB and can be assigned per draft.
- Workspace management supports:
  - create workspace
  - assign or remove a draft from a workspace
  - filter the grid to a single workspace
  - delete a workspace and clear its draft associations
- Workspace names are part of the searchable draft blob and direct-link state.

#### Queue and JSONL batch workflow

- Creator Tools includes a JSONL prompt queue workflow for batch creation.
- Upload format: one JSON object per line with a prompt payload such as `{"prompt":"..."}`.
- Queue features include:
  - upload and validation
  - queue preview
  - selected prompt browsing
  - remove selected prompt
  - clear queue
  - review queued prompts before launch
  - resume a paused batch after an error
- Queue state is persisted locally, including remaining prompts, selection index, batch status, and per-batch override settings.
- Queue review explicitly documents that Creator Tools overrides can be applied across the batch, including model/duration/gens/orientation/resolution/style/seed.

#### Composer modes and source handling

- Composer modes:
  - **Create** from the current prompt or queued prompt
  - **Remix** from a dropped or selected source draft/post
  - **Extend** from a dropped or selected source draft/post
- Source handling supports:
  - source drafts
  - source posts
  - normalized remix-source metadata for downstream card rendering
  - dropped-source fallback flows when native navigation is required
- Source previews can show thumbnail or preview video depending on what is available.
- First-frame image support is available through drag-and-drop so create flows can start from a supplied first frame.

#### Composer controls and override surface

- Prompt
- Model
- Duration
- Gens count
- Orientation
- Resolution
- Style
- Seed
- These controls are persisted locally and can be used either for one-off creation or as batch overrides injected into queued create requests.

#### Draft actions

- Open draft
- Open published post when a draft has already been posted
- Download preview or best available downloadable media
- Copy prompt
- Post immediately
- Schedule post for later
- Assign/remove workspace
- Bookmark / unbookmark
- Hide / unhide
- Open remix source when available

#### Scheduling

- Scheduled posts are persisted in IndexedDB.
- A background timer checks pending scheduled posts on an interval and attempts to publish them when their scheduled time arrives.
- Draft cards surface scheduling state so a queued/scheduled action is visible from the grid itself.

### Dashboard (`dashboard.html`)

The dashboard is an extension page, not a Sora route. It is opened from the extension action, the injected sidebar button, or the page bridge, and it reuses/focuses an existing dashboard tab when one is already open.

#### Metrics mode

- Type-ahead profile picker backed by a metrics users index.
- Supports normal creator identities plus virtual selections such as:
  - **Top Today**
  - cameo/cast-derived identities
- Metric cards include:
  - views
  - unique viewers
  - likes
  - replies/comments
  - remixes
  - total interactions
  - cast-in counts
  - followers
- The post list supports per-post visibility toggles and stored visibility presets.
- Visibility tools include:
  - show all
  - hide all
  - top IR
  - top RR
  - bottom IR
  - bottom RR
  - most remixes
  - most comments
  - stale posts
  - custom saved visibility filters
- Gather note links can jump you back into a page configured to collect more data for the current identity.

#### Harvest mode

- Reads Harvest records from on-device IndexedDB.
- Presents a unified browser across Top/Profile/Drafts harvest contexts.
- Includes:
  - filtering
  - sorting
  - pagination
  - row selection
  - a detail panel
  - prompt inspection
  - permalink and backend endpoint links when available
- The summary area shows filtered counts versus total stored Harvest rows plus last-sync timing.

#### Compare mode

- Multi-user compare pills let you compare multiple creators side by side.
- Compare mode hydrates full snapshot history for the compared users instead of relying only on hot latest values.
- Supports aggregate totals across all selected creators while still keeping per-user series visible in the charts.

#### Chart families

- Interaction rate views
- Total views over time
- Views per person over time
- First-24-hours views curves
- All-post cumulative views
- All-post cumulative likes
- Cast-in history
- Followers history
- Compare-mode aggregate chart variants
- Supports **Linear** and **Stacked** chart display modes.

#### Import, export, and purge utilities

- Metrics CSV import
- Metrics CSV export
- Full all-data CSV export
- Harvest CSV export for:
  - all records
  - current filtered view
- Harvest JSONL export for:
  - all records
  - current filtered view
- Purge tooling can remove data based on retention and profile thresholds instead of only offering full reset behavior.
- Per-post purge exists for surgical cleanup of a specific post without discarding the whole dataset.

#### Profile picker and visibility controls

- Type-ahead search for creators
- Cameo-aware suggestion list
- Top Today quick access
- Persisted per-user visibility choices
- Saved custom post subsets
- Responsive hydrate indicators so partial data loads are visible instead of silent

## Architecture

### Runtime Surfaces

- **Manifest**: [manifest.json](./manifest.json)
- **Content bridge**: [content.js](./content.js)
- **Injected page scripts**: [api.js](./api.js) and [inject.js](./inject.js)
- **Creator Tools modules**: [uv-drafts-logic.js](./uv-drafts-logic.js) and [uv-drafts-page.js](./uv-drafts-page.js)
- **Background service worker**: [background.js](./background.js)
- **Dashboard UI**: [dashboard.html](./dashboard.html), [dashboard.js](./dashboard.js), [dashboard.css](./dashboard.css), [theme.js](./theme.js)

### Routes and Entry Points

- Native Sora routes used by the extension:
  - `/explore`
  - `/profile/<handle>`
  - `/drafts`
  - `/p/<id>`
  - `/d/<id>`
- Extension virtual route:
  - `/creatortools`
- Extension page:
  - `dashboard.html`

### Manifest + Runtime Responsibilities

- `content.js` injects page scripts on Sora pages and lazy-loads the Creator Tools modules only when the route matches the Creator Tools surface.
- `inject.js` handles page-context interception, overlay rendering, runtime controls, Harvest capture, dashboard button injection, and Creator Tools navigation helpers.
- `background.js` is the single writer for metrics state and Harvest state. Page scripts and content scripts send sanitized batches to it; the service worker owns persistence and merge behavior.
- `dashboard.js` reads the local datasets and renders the analytics UI, including metrics mode, compare mode, and Harvest mode.

### Data Flow (High Level)

1. `inject.js` observes Sora route state, DOM state, and page-context API traffic.
2. Relevant page payloads are normalized into metrics and Harvest records in page context.
3. `content.js` acts as the constrained bridge between page context and the extension runtime.
4. `background.js` sanitizes and merges incoming batches, then persists them as the canonical local state.
5. Metrics hot state stays in `chrome.storage.local`, while large historical or record-oriented datasets are split into cold storage layers.
6. Creator Tools reads its own local IndexedDB cache, merges in live drafts/pending responses, and persists UI state in `localStorage`.
7. `dashboard.js` hydrates metrics and Harvest data from local storage backends, then renders charts, compare views, and export utilities.

Cross-context notes:

- Message payloads are schema-limited before they cross the page/extension boundary.
- The dashboard open action reuses an existing dashboard tab instead of creating duplicates.
- Creator Tools is extension-owned UI mounted on top of a Sora route, not server-rendered by Sora itself.

### Storage Model

- **`chrome.storage.local`**
  - hot metrics state (`metrics`)
  - metrics users index
  - metrics updated timestamps
  - Harvest metadata (`harvestRecordsV1`, `harvestUpdatedAt`, storage version)
- **`localStorage`**
  - Creator Tools view state
  - Creator Tools composer settings
  - pending queue / batch state
  - sync progress / mark-all-read progress
  - dashboard mode, chart mode, theme, session cache, and UI preferences
- **IndexedDB**
  - Creator Tools cache database: `SORA_UV_DRAFTS_CACHE`
  - Creator Tools stores:
    - `drafts`
    - `thumbnails`
    - `previews`
    - `workspaces`
    - `scheduled_posts`
    - `seen_drafts`
    - `sync_state`
  - Harvest database: `SCT_HARVEST_DB_V1`

Metrics storage details:

- Hot/latest-per-post metrics stay in `chrome.storage.local` for fast access.
- Historical snapshots are sharded into cold keys such as `snapshots_<userKey>`.
- Migration logic keeps older storage shapes usable through versioned upgrades.

Harvest storage details:

- Harvest records are persisted in IndexedDB by the background service worker.
- `chrome.storage.local` stores only the metadata required for discovery, counts, and update timestamps.
- The dashboard reads IndexedDB records and applies owner-identity fallback from metrics when older rows are missing ownership info.

## Privacy

- No external analytics or telemetry endpoints are added by this extension.
- Data remains on-device in browser-managed storage.
- Network activity stays scoped to the Sora/OpenAI endpoints already used for Sora itself.
- Message bridges validate payload shape and sender scope before processing local writes.

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

### Local workflow

1. Load the extension unpacked in Chrome.
2. Make your code or documentation change in this repository.
3. Reload the extension in `chrome://extensions`.
4. Refresh any open `https://sora.chatgpt.com/*` tabs so the new content/injected scripts are active.
5. Re-open `dashboard.html` or `/creatortools` if you changed those surfaces.

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

Builds the production artifact that can be attached to a release or distributed for manual install.

```bash
rm -f release.zip && zip -r release.zip manifest.json *.js *.html *.css icons imagery -x "*.DS_Store"
```

### Local data implications

- Metrics, Harvest records, Creator Tools cache, workspaces, scheduled posts, and preferences are local to the browser profile.
- Clearing extension storage or site storage removes captured history and cached draft state.
- Reloading the extension does not automatically clear local datasets.

## Testing Status

Current repository test suite (Node built-in test runner), verified on March 7, 2026:

- `202` tests total
- `163` passing
- `39` skipped
- `0` failing

Current automated coverage primarily targets:

- dashboard regressions and storage hydration
- Harvest sanitization and export logic
- injected routing and content guards
- Creator Tools shared logic, queue state, and route regressions

## Project Layout

- [manifest.json](./manifest.json): MV3 configuration, extension surfaces, and asset registration
- [content.js](./content.js): content-script bridge between injected page scripts and the extension runtime
- [inject.js](./inject.js): Sora-page overlays, runtime controls, Harvest capture, sidebar buttons, and routing helpers
- [api.js](./api.js): composer/network interception helpers and request override support
- [uv-drafts-page.js](./uv-drafts-page.js): Creator Tools page module for the `/creatortools` virtual route
- [uv-drafts-logic.js](./uv-drafts-logic.js): shared pure logic for Creator Tools runtime behavior and tests
- [background.js](./background.js): metrics persistence, Harvest persistence, local merge logic, and dashboard-tab coordination
- [dashboard.html](./dashboard.html): dashboard document shell
- [dashboard.js](./dashboard.js): metrics mode, compare mode, Harvest mode, import/export, and purge behavior
- [dashboard.css](./dashboard.css): dashboard styling
- [theme.js](./theme.js): dashboard theme helpers
- `tests/*.test.js`: regression and unit/integration coverage across dashboard, routing, Harvest, and Creator Tools logic

## Notes

- Gather mode works best in a dedicated window or long-lived tab if you want uninterrupted local collection.
- Creator Tools is an extension-owned overlay surface mounted on `/creatortools`, not a server-backed Sora page.
- After changing any injected script, always reload the unpacked extension and refresh the target Sora tab.

## Contributing

Contributions are accepted under the DCO. See [CONTRIBUTING.md](./CONTRIBUTING.md).
Contributor attribution is tracked in [CONTRIBUTORS.md](./CONTRIBUTORS.md).

## License

MIT. See [LICENSE](./LICENSE).

## More Visuals

![](/imagery/extension3.jpg)
![](/imagery/extension4.jpg)

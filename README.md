[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE) [![Add to Chrome](https://img.shields.io/badge/Chrome%20Extension-Add%20Now-blue?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/sora-explore-unique-views/nijonhldjpdanckbnkjgifghnkekmljk?)

<p>
  <strong>🧡 Supported by Our Sponsors</strong><br>
  <a href="https://sorastats.com">
    <img src="/imagery/Sorastat-logo.png" alt="SoraStats Sponsor" width="187">
  </a>
</p>

# Sora Creator Tools: _Video Stats, Post Analytics, View Tracker, & More_


![](/imagery/extension1.jpg)

![](/imagery/extension2.jpg)

![](/imagery/extension5.webp)

## Features:
- **Post View Counts** - Shows unique view counts right on Sora Explore, profile grids, and post pages.
- **Post Like Rate** - Displays like rate (likes ÷ unique viewers) alongside the Unique count when available.
- **Post Remix Rate** - See Remix Rate (recursive) as RR!
- **Post Hotness** - All posts with over 25 likes are color coded with a **red to yellow** gradient based on time elapsed since posting to visually signal hotness (planned feature: incorporate engagement rate to better influence color coding and emoji assignment)
- **Super Hot!** - A post with more than 50 likes in under 1 hour will receive a special red glow and extra emojis to indicate a certified banger destined for Top
- **Best Posting Time** - All posts made within 15 minutes +/- of the current time on 1 day increments into the past receive a **green** label, allowing you to infer what engagement you could potentially attain if you were to post right now
- **Gather Mode** - Turn on Gather mode on any profile to auto-scroll and refresh Sora, auto-populating your local dashboard with current data in the background as long as it runs (runs as fast as 1-2 minute or slow as 15-17 minute intervals). Works on Top in a non-abusive fashion! Please see _notes_ section below for a tip on this Mode.
- **Analyze Mode** – Click on Analyze to view the Top feed in a _very powerful_ way, right in your browser!

Plus **DASHBOARD MODE:** Click on the extension icon to open a full-page dashboard in a new tab that lets you...
- Type-ahead search to quickly select a user (with clear selection state)
- See a colorized scatter/line chart of Like Rate (Y) vs Unique Viewers (X) over time for each post
- Hover tooltips, per-post colors, and trend lines; click a point to open the post
- Thumbnails and direct links in the post list; select up to two posts to compare
- Export all snapshots for a user as CSV
- Pair with Gather Mode for always-current data
- ALL DATA STORED 100% LOCALLY IN YOUR BROWSER AND NEVER TRANSMITTED!

---

## Load it in Chrome

Download directly from the [Chrome Web Store ](https://chromewebstore.google.com/detail/sora-explore-unique-views/nijonhldjpdanckbnkjgifghnkekmljk?)

## Install (Desktop)

### Desktop Chrome (unpacked)
1. Clone/download this repo.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the folder that contains `manifest.json`.
6. (Optional) Pin the extension in the toolbar.

### Desktop Firefox (temporary add-on)
1. Clone/download this repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...**
4. Select `manifest.json` from the repo folder.

Note: Temporary add-ons are removed when Firefox restarts. For permanent install you must package/sign an `.xpi` (outside the scope of this README).

## Install (Mobile)

### Mobile Chrome
Chrome on mobile does not support installing extensions.

Workaround (Android): use a Chromium-based browser that supports extensions (example: Kiwi Browser) and load/install the extension there.

### Mobile Firefox
Firefox on mobile only supports a limited add-on install flow.

- Android: You typically need Firefox Nightly (or a build that supports custom add-on collections) and a signed add-on to install a custom extension.
- iOS: Custom extensions are not supported in Firefox for iOS.

## Use it
- Browse Explore, your profile, or any `/p/s_*` post.
- The extension sniffs feed responses and drops a `Unique: *` badge on each card plus a sticky badge on the post detail view. When likes and unique viewers are present, the badge shows `Unique: <count> • <like-rate%>`. Hover to see `Likes` and `Views`.
- When you view explore feeds or profile feeds, the extension records snapshots for each visible post: `unique`, `likes`, `views`, and a timestamp. These are stored locally in `chrome.storage.local` and power the dashboard.

### Dashboard notes
- X-axis is Unique Viewers; Y-axis is Like Rate (%). As a post reaches a broader audience, points often drift rightwards (more unique) while Y can trend down.
- Select up to 2 posts to compare. Others remain in the background for context.
- Data is stored locally on your machine. Clearing site data or extension storage removes it.
- If you tweak code, just hit the **Reload** button in `chrome://extensions` to see your changes.

## Notes
- Content script injects `inject.js` so it can hook `fetch`/XHR in the page context.
- Runs fully locally-no background worker, no external calls.
- **Tip for Gather Mode:** Open a profile in its **own window** with **no other tabs** (can be dragged out of your way) to ensure Chrome does not put the tab to sleep. Further, consider toggling "Auto Discardable" to **X** for this tab by visiting chrome://discards/ to maximize capability.

## License
This project is licensed under the MIT License (see [LICENSE](./LICENSE)).

Contributors:
- Will ([@fancyson](https://fancyson.ai))
- Topher ([@cameoed](https://sora.com/profile/cameoed))
- Skye ([@cosmic-skye](https://skye.page))

Contributions are accepted under the DCO (see [CONTRIBUTING.md](./CONTRIBUTING.md)).

---

## More visuals:

![](/imagery/extension3.jpg)

![](/imagery/extension4.jpg)










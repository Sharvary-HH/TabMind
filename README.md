# TabMind — AI-Powered Chrome Tab Manager

> Cluster, search, and organise hundreds of browser tabs — with optional AI grouping via the Anthropic API.

---

## Features

| Feature | Description |
|---|---|
| **Smart clustering** | Heuristic grouping by domain/category (instant, offline) |
| **AI clustering** | Claude-powered semantic grouping — understands context, not just domain |
| **Command palette** | `Ctrl+K` / `Cmd+K` — fuzzy-search every open tab in milliseconds |
| **Session workspaces** | Save and restore named collections of tabs |
| **Duplicate detection** | Highlights and closes duplicate tabs in one click |
| **Tab aging** | See how old each tab is; bulk-suspend tabs unused for 7+ days |
| **Filter pills** | Quickly view Recent / Old / Duplicate tabs across all groups |

---

## Installation (Developer Mode)

Chrome extensions can be loaded unpacked — no store listing needed.

1. **Clone / download** this folder to your computer
2. Open Chrome and go to `chrome://extensions`
3. Toggle **Developer mode** (top-right)
4. Click **Load unpacked** and select the `tabmind/` folder
5. Pin the TabMind icon from the extensions toolbar

---

## Setup

### Using heuristic clustering (no API key needed)

Works out of the box. Open the extension — tabs are automatically grouped by domain category (Dev, Research, Shopping, Social, Video, Work, News).

### Using AI clustering (requires Anthropic API key)

1. Get a free API key at [console.anthropic.com](https://console.anthropic.com)
2. Open TabMind → click ⚙ Settings
3. Paste your key (`sk-ant-...`) and click Save
4. Click **✦ AI Cluster** — Claude reads your tab titles and groups them semantically

AI clustering sends only tab **titles and domains** to the API — no page content, no personal data.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` / `Cmd+Shift+Space` | Open TabMind popup |
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `↑` `↓` | Navigate palette results |
| `Enter` | Jump to selected tab |
| `Esc` | Close palette / settings |

---

## Project Structure

```
tabmind/
├── manifest.json              Chrome MV3 manifest
├── background/
│   └── service-worker.js      Tab tracking, messaging, alarms
├── popup/
│   ├── popup.html             Main UI shell
│   ├── popup.css              Dark theme styles (Syne + DM Mono fonts)
│   ├── popup.js               App controller — render, events, AI
│   └── clustering.js          Heuristic + AI clustering, fuzzy search, utils
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## How AI Clustering Works

When you click **✦ AI Cluster**, the extension:

1. Collects all open tab **titles + domains** (no page content)
2. Sends a single API call to `claude-sonnet-4-20250514`
3. Asks Claude to group them into meaningful clusters with names + colors
4. Renders the new groups in the sidebar

The prompt uses `max_tokens: 2000` and expects a JSON response — cheap and fast even with 200+ tabs.

---

## Adding More Domain Categories

Edit the `DOMAIN_CATEGORIES` object in `popup/clustering.js`:

```js
const DOMAIN_CATEGORIES = {
  'yoursite.com': 'My Category',
  // ...
};
```

And add a color in `CATEGORY_COLORS`:

```js
const CATEGORY_COLORS = {
  'My Category': '#ff6b6b',
  // ...
};
```

---

## Privacy

- **No data leaves your browser** unless you use AI clustering
- AI clustering sends only tab titles + domain names (not URLs, not page content)
- Workspaces and settings are stored in `chrome.storage.sync` (your Google account, encrypted)
- Tab metadata (last active timestamps) is stored in `chrome.storage.local` only

---

## Extending TabMind

Ideas for next features:

- **Tab graph view** — visualise parent-child relationships between tabs
- **Auto-cluster on open** — trigger heuristic clustering automatically when tab count exceeds N
- **Browser history search** — extend fuzzy search to closed tabs via `chrome.history`
- **Export/import workspaces** — JSON import/export for sharing tab sets
- **Tab notes** — attach a sticky note to any tab
- **Usage heatmap** — show which tabs you visit most

---

## Tech Stack

- Chrome Extensions Manifest V3
- Vanilla JS (ES Modules) — no build step required
- Anthropic Claude API (`claude-sonnet-4-20250514`) for AI clustering
- Google Fonts: [Syne](https://fonts.google.com/specimen/Syne) + [DM Mono](https://fonts.google.com/specimen/DM+Mono)

---

## License

MIT — use freely, build on top of it, ship your own version.

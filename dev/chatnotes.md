```
npm run dev:renderer   # Vite only, opens in browser
npm run dev:headless   # Uses xvfb-run for headless Electron
```

### Verification:

npm run build passes.
npm run dev no longer fails on chrome-sandbox.
It now fails here with Missing X server or $DISPLAY, which means this shell has no GUI display attached.
### Use:
```
npm run dev
```
from a real graphical Ubuntu terminal.

### For SSH/headless:
```
npm run dev:renderer
```
For headless Electron smoke testing, install Xvfb first:

sudo apt install xvfb
npm run dev:headless
To use Chromium’s real setuid sandbox later, fix the binary permissions and opt in:

sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
SECOND_BRAIN_DEV_CHROMIUM_SANDBOX=1 npm run dev


-----

Two things were happening:

1. Your original `dev:headless` did start Electron, but Chromium was complaining about DBus/GPU inside Xvfb.
2. My test also found a port conflict risk: if `dev:renderer` is already running on `5173`, headless should not try to reuse it.

I updated:
- [package.json](/home/rushat/second-brain/package.json): `dev:headless` now uses port `5174`.
- [vite.config.ts](/home/rushat/second-brain/vite.config.ts): Vite reads `VITE_PORT`.
- [start-electron-dev.cjs](/home/rushat/second-brain/scripts/start-electron-dev.cjs): headless launches with Linux Xvfb-friendly GPU flags.

`npm run build` passes.

Now run:

```bash
npm run dev:headless
```

You may still see `xdg-desktop-portal`, `GSettings`, or `DBus` warnings. Those are from the host’s minimal headless desktop stack, not from the app. For a cleaner headless environment, install the missing desktop runtime pieces:

```bash
sudo apt install xvfb dbus-x11 gsettings-desktop-schemas xdg-desktop-portal xdg-desktop-portal-gtk gvfs-fuse at-spi2-core
```

Also: `dev:headless` is mostly useful as a smoke test. For actually viewing and developing UI, keep using:

```bash
npm run dev:renderer
```

-------
1. **Windows executable Python/Graphify detection**

Partially.

For graph creation, [GraphifyController.ts](/home/rushat/second-brain/src/main/services/GraphifyController.ts:297) runs:

```ts
graphify update .
```

So on Windows it will work **if `graphify.exe` is on PATH** for the packaged Electron process.

For MCP, current Windows behavior is weaker. [resolveMcpCommand()](/home/rushat/second-brain/src/main/services/GraphifyController.ts:406) returns:

```ts
python
```

on `win32`, then starts:

```bash
python -m graphify.serve <graph.json>
```

So it does **not yet discover the exact Python that owns Graphify**. It assumes `python` resolves correctly and that `import graphify` works there. You can override with:

```bash
SECOND_BRAIN_GRAPHIFY_MCP_COMMAND=C:\Path\To\python.exe
SECOND_BRAIN_GRAPHIFY_MCP_ARGS="-m graphify.serve {graphPath}"
```

I’d recommend hardening this before relying on Windows users: try `py -3`, `python`, `where graphify`, then verify each candidate with `python -c "import graphify"`.

2. **Graphify utilities for graph/card control**

The useful knobs are:

- `graphify extract <path>`: full extraction. Best for raw user vault ingestion.
- `--mode deep`: richer semantic inferred edges, useful for smarter topic/subtopic grouping.
- `--directed`: preserve edge direction if you want parent/child style relationships.
- `--no-cluster`: skip community clustering when you want raw nodes only.
- `graphify update <path>`: incremental code update. Current app uses this, but for PDFs/docs/jobs we may want `extract` or a semantic update flow.
- `graphify cluster-only <path>`: rerun clustering on an existing graph.
- `graphify label <path>`: rename communities.
- `graphify query`, `path`, `explain`: runtime graph navigation for the AI.
- `graphify tree`: emits hierarchical tree HTML; conceptually useful for topic/subtopic UI.
- `graphify export obsidian/wiki/svg/graphml`: export forms if you want alternate card sources.

For **topic and subtopic cards**, Graphify itself gives the raw ingredients, not the final app cards:

- `graph.json.nodes[*].community` -> topic grouping
- `.graphify_labels.json` or labeled report -> topic names
- node `label`, `source_file`, `source_location`, `file_type` -> subtopic/card metadata
- `links`/`edges` with `relation`, `confidence`, `weight` -> card connections
- `god_nodes` from report/analysis -> likely pinned or high-importance cards

Important: the app does **not yet convert Graphify communities into board topic/subtopic cards**. It currently updates Graphify and uses MCP for Job Tracker extraction. The next architectural step is a `GraphifyBoardService` that reads `graph.json`, maps communities to `OrganizedBoardTopic[]`, and lets you configure clustering/card rules like “community as topic”, “source file as topic”, or “job/company as topic.”
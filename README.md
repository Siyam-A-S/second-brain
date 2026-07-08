# Second Brain

**Release: Second Brain 0.1.5**

Second Brain is a local-first desktop app for turning dropped notes, code, documents, images, and research material into a browsable knowledge graph with chat, source exploration, and Graphify-powered ingestion.

[Open the latest development release](https://github.com/Siyam-A-S/second-brain/releases)

## Download

- Windows development zip: published on `vX.Y.Z` GitHub releases.
- macOS Apple Silicon development DMG: published on `vX.Y.Z` GitHub releases.

## Production Distribution

Production releases are distributed through [downloadsecondbrain.com](https://www.downloadsecondbrain.com) and use `prod-vX.Y.Z` release tags. Production builds are managed-account builds: users sign in with the same Supabase email/password account used on the website, and the desktop app uses the managed Second Brain proxy for AI access.

Production bundles intentionally hide developer surfaces such as grounding inspection, raw Graphify command output, local endpoint/model controls, and detailed error messages. Customer-facing errors are shown as `Something went wrong. Try again.` while redacted diagnostic logs are stored locally and uploaded best-effort for support.

Production assets:

- Windows installer: `Second-Brain-Setup-<version>-prod.exe`
- macOS Apple Silicon DMG: `Second-Brain-<version>-prod-mac-arm64.dmg`

Production installers include the minimal Python/Graphify runtime needed for ingestion and PDF artifacts. See [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) for production tag rules, runtime bundle behavior, account access, and diagnostics policy.

## Development Windows Get Started

1. Download the development Windows zip and extract the entire folder.
2. Install Python 3.10 or newer:

   ```powershell
   winget install -e --id Python.Python.3.12 --scope user
   ```

3. Install `uv`:

   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```

4. Install Graphify with the file support used by Second Brain:

   ```powershell
   uv tool install --upgrade "graphifyy[all]"
   uv tool ensurepath
   uv tool run --from "graphifyy[all]" graphify --help
   ```

5. Restart PowerShell if `uv` or `graphify` is not found immediately.
6. Run `Second Brain.exe` from the extracted release folder.

If Graphify is installed somewhere custom, set `SECOND_BRAIN_GRAPHIFY_BIN` to the full `graphify.exe` or `graphify.cmd` path before launching the app.

## Development macOS Apple Silicon Beta Get Started

The macOS build is prepared for beta testing and is not notarized yet. macOS Gatekeeper may block the first launch as an unidentified developer app.

1. Download the macOS DMG.
2. Open the DMG and drag `Second Brain.app` into `Applications`.
3. Install Homebrew dependencies:

   ```bash
   brew install python uv
   ```

4. Install Graphify:

   ```bash
   uv tool install --upgrade "graphifyy[all]"
   uv tool ensurepath
   uv tool run --from "graphifyy[all]" graphify --help
   ```

5. Open `Applications` and launch `Second Brain.app`.
6. If macOS blocks the app, click `Cancel`, then open `System Settings` -> `Privacy & Security`, scroll to `Security`, and click `Open Anyway` for Second Brain.

On Apple Silicon Macs, Second Brain checks common Homebrew paths such as `/opt/homebrew/bin`. On Intel Macs, it also checks `/usr/local/bin`.

## Connect AI

Development builds expose a single global AI mode.

- Use Proxy AI: default mode for paid users. Enter your Secret Key in Settings; the app uses the managed Second Brain proxy for chat and Graphify workflows.
- Use Local AI: advanced mode for local OpenAI-compatible servers. Enter the base URL, model name, and Graphify limits in Settings.

Production builds are proxy-first and account-managed. End users sign in with their website email/password; local endpoint/model settings and raw grounding controls are not shown.

For a local llama.cpp server:

```bash
./llama-server -m "/path/to/your-model.gguf" --host 127.0.0.1 --port 8080 -c 32768
```

Use these local settings:

```text
Base URL: http://localhost:8080/v1
Model: local-model
API key: leave blank for a local server
```

If your local model cannot support a 32k context, lower the Graphify max-token settings in Settings before ingesting large sources.

## Runtime Dependencies

Second Brain depends on `python`, `uv`, and `graphify` for local ingestion. You can check and repair dependency status from Settings inside the app.

Useful overrides:

| Variable | Purpose |
| --- | --- |
| `SECOND_BRAIN_GRAPHIFY_BIN` | Full path to the Graphify executable when auto-detection is not enough |
| `SECOND_BRAIN_LLM_ENDPOINT` | Local AI chat-completions endpoint override |
| `SECOND_BRAIN_LLM_MODEL` | Local AI model override |
| `SECOND_BRAIN_LLM_API_KEY` | Local or hosted provider API key override |
| `SECOND_BRAIN_GRAPHIFY_MAX_TOKENS` | Local Graphify completion budget |
| `SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS` | Local strict JSON retry budget |
| `SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS` | Graphify command timeout in milliseconds |

## Develop

Node.js 22 is recommended for release parity.

```bash
git clone https://github.com/Siyam-A-S/second-brain.git
cd second-brain
npm ci
npm run dev
```

Build release packages:

```bash
npm run package:win
npm run package:mac:adhoc
```

Build production packages:

```bash
npm run package:prod:win:installer
npm run package:prod:mac:dmg
```

Pushing a `vX.Y.Z` tag, or manually running the **Release Second Brain** GitHub Action, publishes the Windows zip and macOS Apple Silicon DMG for development testing.

Pushing a `prod-vX.Y.Z` style tag, or manually running **Production Release Second Brain**, publishes bundled-runtime production assets for website-managed distribution.

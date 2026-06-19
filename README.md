# Second Brain

**Release: Second Brain 0.1.0**

Second Brain is a local-first Windows app that turns dropped notes, code, documents, and images into a browsable knowledge graph.

[Download Second Brain 0.1.0 for Windows](https://github.com/Siyam-A-S/second-brain/releases/download/v0.1.0/Second-Brain-0.1.0-latest-win-unpacked.zip)

If the direct download is not available yet, open the [GitHub Releases page](https://github.com/Siyam-A-S/second-brain/releases) and download `Second-Brain-0.1.0-latest-win-unpacked.zip`.

## Install

1. Install [Python 3.10 or newer](https://www.python.org/downloads/windows/) and enable **Add Python to PATH** during setup.
2. Install `uv` in PowerShell:

   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```

3. Install [Graphify](https://github.com/safishamsi/graphify) with document, Office, AI, and MCP support:

   ```powershell
   uv tool install --upgrade "graphifyy[pdf,office,openai,mcp]"
   uv tool ensurepath
   uv tool run --from "graphifyy[pdf,office,openai,mcp]" graphify --help
   ```

   For research-paper mode, add the richer local PDF tools to the same Graphify tool environment:

   ```powershell
   uv tool install --upgrade "graphifyy[pdf,office,openai,mcp]" --with pymupdf --with pymupdf4llm --with numpy --with matplotlib
   ```

   These packages let Second Brain break PDFs into paper sections, figures, tables, references, claims, methods, datasets, and results before Graphify builds the graph. If they are missing, the app falls back to plain PDF text extraction and shows setup guidance in Settings.

4. Download the release zip, extract the entire folder, and run `Second Brain.exe`.

Restart PowerShell and Second Brain if Windows cannot find `uv` or `graphify` immediately after installation.

## Connect AI

Second Brain works with an OpenAI-compatible chat-completions endpoint. Configure the endpoint, model, and optional API key in the app's AI settings.

For a local llama.cpp server:

```powershell
./llama-server.exe -m "C:\models\your-model.gguf" --host 127.0.0.1 --port 8080 -c 8192
```

Use these settings in Second Brain:

```text
Endpoint: http://localhost:8080/v1/chat/completions
Model: local-model
API key: leave blank for a local server
```

For a hosted provider, enter its OpenAI-compatible `/v1/chat/completions` URL, model name, and API key instead. Vertex AI OpenAPI base URLs such as `https://aiplatform.googleapis.com/v1/projects/.../locations/.../endpoints/openapi/` are also accepted.
Second Brain adapts to common cloud differences such as `max_tokens` versus `max_completion_tokens`, unsupported custom temperature, and JSON-mode fallbacks. If definition enrichment fails, the Graph Board shows the AI endpoint error while keeping Graphify summaries visible.

## Environment Variables

The in-app AI settings are recommended. Environment variables override saved settings and are useful for testing or custom Graphify installations.

| Variable | Purpose | Default |
| --- | --- | --- |
| `SECOND_BRAIN_LLM_ENDPOINT` | AI chat-completions URL | `http://localhost:8080/v1/chat/completions` |
| `SECOND_BRAIN_LLM_MODEL` | Model name sent to the endpoint | `local-model` |
| `SECOND_BRAIN_LLM_API_KEY` | API key for hosted providers | Local placeholder |
| `SECOND_BRAIN_GRAPHIFY_BIN` | Full path to `graphify.exe` when it is not on `PATH` | Auto-detected |
| `SECOND_BRAIN_GRAPHIFY_MAX_TOKENS` | Primary Graphify completion budget | `8192` |
| `SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET` | Graphify extraction chunk token budget | Same as max tokens |
| `SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS` | Strict JSON retry budget | `4096` |
| `SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS` | Graphify command timeout in milliseconds | `600000` |
| `SECOND_BRAIN_CARD_DEFINITIONS` | Set to `0` to disable card-definition enrichment | Enabled |
| `SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS` | Maximum cards enriched after one ingestion | `24` |
| `SECOND_BRAIN_PAPER_COMPONENTS` | Set to `0` to disable generated research-paper sidecars | Enabled |

Generated paper artifacts are rebuildable cache files under each project at `vault/raw/paper-components/`. Explorer hides them from ordinary source delete/rename/merge actions, but exposes their sections, figures, tables, references, methods, datasets, claims, and results as graph workbench artifacts.

Set variables for the current PowerShell window before launching the app:

```powershell
$env:SECOND_BRAIN_LLM_ENDPOINT = "http://localhost:8080/v1/chat/completions"
$env:SECOND_BRAIN_LLM_MODEL = "local-model"
$env:SECOND_BRAIN_GRAPHIFY_BIN = "$env:USERPROFILE\.local\bin\graphify.exe"
& ".\Second Brain.exe"
```

Use Windows **Environment Variables** settings when you want these values to persist across restarts.

## Develop

Node.js 20 or newer is recommended.

```powershell
git clone https://github.com/Siyam-A-S/second-brain.git
cd second-brain
npm ci
npm run dev
```

Build the Windows portable release:

```powershell
npm run package:win
```

The downloadable asset is written to:

```text
release/Second-Brain-0.1.0-latest-win-unpacked.zip
```

Pushing a `v0.1.0` tag, or manually running the **Release Second Brain** GitHub Action, publishes that zip under the release title **Second Brain 0.1.0**.

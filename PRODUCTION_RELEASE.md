# Production Release Guide

Second Brain now ships from one main branch with two build channels.

## Channels

- Development: default channel. Use this for local testing, Windows portable zips, macOS beta DMGs, detailed errors, local runtime controls, and grounding/debug UI.
- Production: set `SECOND_BRAIN_BUILD_CHANNEL=production`. Use this for customer-facing managed-service builds distributed through `https://www.downloadsecondbrain.com`.

Production tags must use:

```text
prod-vX.Y.Z
```

Development tags continue to use:

```text
vX.Y.Z
```

## Build Metadata

Packaged builds expose typed metadata to the renderer through `window.api.app.getBuildInfo()`:

- `channel`: `development` or `production`
- `version`
- `buildId`
- `gitCommit`
- `target`
- `websiteUrl`
- `proxyUrl`
- `supabaseUrl`
- `supabaseAnonKey`

Portable builds also write `BUILD_INFO.txt` with the same channel signal.

## Development Packaging

The existing test workflows remain unchanged:

```bash
npm run package:win
npm run package:mac:adhoc
```

Development builds keep grounding inspection, raw error details, local runtime settings, model settings, Graphify command output, and debug statuses.

## Production Packaging

Production scripts:

```bash
npm run package:prod:win:installer
npm run package:prod:mac:dmg
```

The production GitHub workflow lives at:

```text
.github/workflows/production-release.yml
```

It uploads:

- `Second-Brain-Setup-<version>-prod.exe`
- `Second-Brain-<version>-prod-mac-arm64.dmg`

Production builds require these CI secrets:

- `SECOND_BRAIN_SUPABASE_URL`
- `SECOND_BRAIN_SUPABASE_ANON_KEY`

The packaging script fails before Electron Builder runs if the compiled build metadata is not production or if the Supabase configuration is missing.

## Runtime Dependencies

Production packages include a bundled minimal Python runtime under Electron `resources/runtime/<platform>-<arch>/`.

The CI runtime preparation step installs only the default production dependencies:

- `graphifyy[pdf,office,openai,mcp]`
- `fpdf2`
- `pypdf`

Video/transcription dependencies are intentionally excluded from the default bundle to keep installer size manageable. The runtime preparation script prunes caches, tests, docs, `__pycache__`, `idlelib`, `tkinter`, `ensurepip`, headers, and static libraries where safe.

The app still verifies dependencies at first run and prefers the bundled runtime before checking system Python, uv, or PATH Graphify.

## Managed Account Access

Production Settings are account-first. Customers sign in with the same Supabase email/password account used on:

```text
https://www.downloadsecondbrain.com
```

The desktop app stores Supabase session tokens in Electron secure storage and never exposes access or refresh tokens to the renderer. Model names, endpoints, local Graphify token controls, and grounding debug views are hidden from production UI.

Desktop account endpoints:

- `GET https://www.downloadsecondbrain.com/api/desktop/account`
- `POST https://www.downloadsecondbrain.com/api/desktop/logs`

Both use:

```text
Authorization: Bearer <supabase_access_token>
```

The managed AI proxy must accept the same Supabase bearer token, validate it server-side, enforce plan/usage, and forward approved requests to Vertex. Graphify proxy mode receives that token as `OPENAI_API_KEY` and uses `OPENAI_BASE_URL=https://graphify-proxy-724616525781.us-central1.run.app/v1`.

## Error And Log Policy

Production UI shows this exact user-facing error:

```text
Something went wrong. Try again.
```

Detailed errors are written as JSONL logs under the app user-data directory:

```text
logs/second-brain-YYYY-MM-DD.jsonl
```

Logs redact access keys, bearer tokens, long prompts, raw document-like content, local user paths, and binary payloads. Upload is best-effort and never blocks chat, ingestion, artifact creation, or settings workflows.

## Distribution

Production releases should be distributed through `www.downloadsecondbrain.com`, not by sharing development zips. The website should track versions, account status, trial/subscription state, and the download links for the latest production release assets.

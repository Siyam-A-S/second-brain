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

Production builds require these GitHub Actions repository variables:

- `SECOND_BRAIN_SUPABASE_URL`
- `SECOND_BRAIN_SUPABASE_ANON_KEY`

The packaging script fails before Electron Builder runs if the compiled build metadata is not production or if the Supabase configuration is missing. Keep service-role keys, Stripe secrets, proxy signing secrets, and admin credentials in GitHub secrets or server-only environment variables; never ship them in desktop build metadata.

## Production Release Commands

Before cutting a production release, confirm the public Supabase build variables exist:

```bash
gh variable list --repo Siyam-A-S/second-brain
```

Run local validation from the repository root:

```bash
npm run typecheck
npm run build

SECOND_BRAIN_BUILD_CHANNEL=production \
SECOND_BRAIN_BUILD_TARGET=test \
SECOND_BRAIN_SUPABASE_URL="$(gh variable list --repo Siyam-A-S/second-brain --json name,value --jq '.[] | select(.name == "SECOND_BRAIN_SUPABASE_URL") | .value')" \
SECOND_BRAIN_SUPABASE_ANON_KEY="$(gh variable list --repo Siyam-A-S/second-brain --json name,value --jq '.[] | select(.name == "SECOND_BRAIN_SUPABASE_ANON_KEY") | .value')" \
SECOND_BRAIN_WEBSITE_URL="https://www.downloadsecondbrain.com" \
SECOND_BRAIN_PROXY_URL="https://graphify-proxy-724616525781.us-central1.run.app" \
npm run build

node scripts/assert-production-build.cjs
npm run build
graphify update .
git diff --check
```

Commit and publish a new production tag:

```bash
VERSION="$(node -p "require('./package.json').version")"
git status --short
git add -u
# Add any intentional new files, for example:
git add WEBSITE_SERVER_HANDOFF.md
git commit -m "Prepare production release v$VERSION"
git push origin master
git tag -a "prod-v$VERSION" -m "Production release v$VERSION"
git push origin "prod-v$VERSION"
```

Watch the workflow and verify uploaded assets:

```bash
RUN_ID="$(gh run list --repo Siyam-A-S/second-brain --workflow production-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --repo Siyam-A-S/second-brain --exit-status
gh release view "prod-v$VERSION" --repo Siyam-A-S/second-brain --json url,assets,tagName,name
```

If you intentionally need to rebuild the same package version, for example after a CI variable or packaging-only fix, move the matching production tag and let the workflow upload assets with `--clobber`:

```bash
VERSION="$(node -p "require('./package.json').version")"
git push origin master
git tag -fa "prod-v$VERSION" -m "Production release v$VERSION"
git push --force origin "prod-v$VERSION"
```

Prefer a new patch version for customer-visible application changes.

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

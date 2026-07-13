# Second Brain Managed Proxy

Tiny Cloud Run proxy for Second Brain AI calls. Chat sends only bounded local Graphify context plus the user question; Graphify ingestion and card-definition enrichment use OpenAI-compatible chat-completions routes. The service validates Supabase bearer tokens, enforces freemium/Pro usage state in Supabase, and forwards approved requests to Vertex AI using Cloud Run's attached service account.

## Routes

- `/generate` accepts the Second Brain chat proxy contract.
- `/chat/completions`, `/v1/chat/completions`, `/generate/chat/completions`, and `/generate/v1/chat/completions` accept OpenAI-compatible chat-completions requests for Graphify and enrichment.

Every route above consumes one daily request for the validated Supabase user before forwarding to the model backend.

## Entitlements

- Signed-in Free users get `250` requests/day by default. Keep this configurable server-side.
- Pro users get `1000` requests/day and are billed at `$10/month` through Stripe.
- Missing, canceled, or expired Pro billing falls back to Free unless the account is explicitly disabled.
- Supabase RPC `consume_proxy_usage` is responsible for resolving the current plan, daily bucket, increment, and `over_limit` response.

## Environment

```text
VERTEX_OPENAPI_ENDPOINT=https://aiplatform.googleapis.com/v1/projects/.../locations/.../endpoints/openapi/chat/completions
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
SECOND_BRAIN_PROXY_MAX_BODY_BYTES=262144
SECOND_BRAIN_PROXY_RATE_LIMIT_PER_MINUTE=30
FREE_DAILY_REQUEST_LIMIT=250
PRO_DAILY_REQUEST_LIMIT=1000
```

`SUPABASE_SERVICE_ROLE_KEY` must be stored as a Cloud Run secret or runtime-only environment value. Do not ship it in desktop builds or frontend `VITE_` variables.

## Run Locally

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8088
```

## Deploy

```bash
gcloud run deploy second-brain-proxy \
  --source . \
  --region us-central1 \
  --service-account second-brain-api-service-account@PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars SUPABASE_URL=https://PROJECT_REF.supabase.co,VERTEX_OPENAPI_ENDPOINT=https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/endpoints/openapi/chat/completions \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=sb-supabase-service-role-key:latest
```

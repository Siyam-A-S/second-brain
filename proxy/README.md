# Second Brain Managed Proxy

Tiny Cloud Run proxy for Second Brain AI calls. Chat sends only bounded local Graphify context plus the user question; Graphify ingestion and card-definition enrichment use OpenAI-compatible chat-completions routes. The service validates the beta secret key and forwards requests to Vertex AI using Cloud Run's attached service account.

## Routes

- `/generate` accepts the Second Brain chat proxy contract.
- `/chat/completions`, `/v1/chat/completions`, and `/generate/chat/completions` accept OpenAI-compatible chat-completions requests for Graphify and enrichment.

## Environment

```text
VERTEX_OPENAPI_ENDPOINT=https://aiplatform.googleapis.com/v1/projects/.../locations/.../endpoints/openapi/chat/completions
SECOND_BRAIN_PROXY_KEYS_SHA256=<comma-separated sha256 hashes>
SECOND_BRAIN_PROXY_MAX_BODY_BYTES=262144
SECOND_BRAIN_PROXY_RATE_LIMIT_PER_MINUTE=30
```

For local development only, `SECOND_BRAIN_PROXY_KEYS` can contain comma-separated raw keys.

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
  --set-env-vars VERTEX_OPENAPI_ENDPOINT=https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/us-central1/endpoints/openapi/chat/completions
```

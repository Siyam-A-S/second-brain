from __future__ import annotations

import hashlib
import os
import time
from collections import defaultdict, deque
from typing import Any

import google.auth
import google.auth.transport.requests
import requests
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


app = FastAPI(title="Second Brain Managed Proxy", version="0.1.0")

RATE_WINDOW_SECONDS = 60
DEFAULT_MAX_BODY_BYTES = 256 * 1024
request_times: dict[str, deque[float]] = defaultdict(deque)


class ProxyMessage(BaseModel):
    role: str
    content: str


class ProxyRequest(BaseModel):
    userIdOrKey: str = Field(default="")
    model: str
    messages: list[ProxyMessage]
    groundingEnabled: bool = True
    requestId: str


def env_int(name: str, fallback: int) -> int:
    try:
        return int(os.getenv(name, str(fallback)))
    except ValueError:
        return fallback


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def configured_key_hashes() -> set[str]:
    hashed = {
        value.strip().lower()
        for value in os.getenv("SECOND_BRAIN_PROXY_KEYS_SHA256", "").split(",")
        if value.strip()
    }
    raw = {
        sha256(value.strip())
        for value in os.getenv("SECOND_BRAIN_PROXY_KEYS", "").split(",")
        if value.strip()
    }
    return hashed | raw


def extract_secret(authorization: str | None, body_key: str) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return body_key.strip()


def validate_secret(secret: str) -> str:
    key_hashes = configured_key_hashes()
    if not key_hashes:
        raise HTTPException(status_code=500, detail="Proxy keys are not configured.")
    if sha256(secret) not in key_hashes:
        raise HTTPException(status_code=401, detail="Invalid Second Brain secret key.")
    return sha256(secret)[:16]


def enforce_rate_limit(key_id: str) -> None:
    limit = env_int("SECOND_BRAIN_PROXY_RATE_LIMIT_PER_MINUTE", 30)
    now = time.time()
    queue = request_times[key_id]
    while queue and now - queue[0] > RATE_WINDOW_SECONDS:
        queue.popleft()
    if len(queue) >= limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")
    queue.append(now)


def vertex_access_token() -> str:
    credentials, _project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token


def build_vertex_body(payload: ProxyRequest) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": payload.model,
        "messages": [message.model_dump() for message in payload.messages],
        "stream": False,
    }

    if payload.groundingEnabled:
        body["grounding"] = {"enabled": True}

    return body


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true"}


def enforce_request_limits(raw_body: bytes) -> None:
    max_body_bytes = env_int("SECOND_BRAIN_PROXY_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES)
    if len(raw_body) > max_body_bytes:
        raise HTTPException(status_code=413, detail="Context packet is too large.")


def validate_request_secret(authorization: str | None, body_key: str) -> str:
    secret = extract_secret(authorization, body_key)
    key_id = validate_secret(secret)
    enforce_rate_limit(key_id)
    return key_id


@app.post("/chat")
@app.post("/generate")
async def chat(request: Request, authorization: str | None = Header(default=None)) -> JSONResponse:
    raw_body = await request.body()
    enforce_request_limits(raw_body)

    payload = ProxyRequest.model_validate_json(raw_body)
    validate_request_secret(authorization, payload.userIdOrKey)

    vertex_endpoint = os.getenv("VERTEX_OPENAPI_ENDPOINT", "").strip()
    if not vertex_endpoint:
        raise HTTPException(status_code=500, detail="VERTEX_OPENAPI_ENDPOINT is not configured.")

    response = requests.post(
        vertex_endpoint,
        headers={
            "Authorization": f"Bearer {vertex_access_token()}",
            "Content-Type": "application/json",
            "X-Second-Brain-Request-Id": payload.requestId,
        },
        json=build_vertex_body(payload),
        timeout=180,
    )

    try:
        response_payload = response.json()
    except ValueError:
        response_payload = {"text": response.text}

    if response.status_code >= 400:
        return JSONResponse(status_code=response.status_code, content={"error": response_payload})

    text = (
        response_payload.get("text")
        or response_payload.get("output_text")
        or (
            response_payload.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            if isinstance(response_payload.get("choices"), list)
            else ""
        )
    )

    return JSONResponse(
        {
            "text": text,
            "groundingMetadata": response_payload.get("groundingMetadata")
            or response_payload.get("grounding_metadata"),
            "usage": response_payload.get("usage") or response_payload.get("usageMetadata"),
            "model": payload.model,
            "requestId": payload.requestId,
        }
    )


@app.post("/chat/completions")
@app.post("/v1/chat/completions")
@app.post("/generate/chat/completions")
async def chat_completions(request: Request, authorization: str | None = Header(default=None)) -> JSONResponse:
    raw_body = await request.body()
    enforce_request_limits(raw_body)

    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Request body must be JSON.")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    body_key = str(payload.pop("userIdOrKey", "") or "")
    validate_request_secret(authorization, body_key)

    vertex_endpoint = os.getenv("VERTEX_OPENAPI_ENDPOINT", "").strip()
    if not vertex_endpoint:
        raise HTTPException(status_code=500, detail="VERTEX_OPENAPI_ENDPOINT is not configured.")

    response = requests.post(
        vertex_endpoint,
        headers={
            "Authorization": f"Bearer {vertex_access_token()}",
            "Content-Type": "application/json",
            "X-Second-Brain-Request-Id": request.headers.get("X-Second-Brain-Request-Id", ""),
        },
        json=payload,
        timeout=180,
    )

    try:
        response_payload = response.json()
    except ValueError:
        response_payload = {"text": response.text}

    return JSONResponse(status_code=response.status_code, content=response_payload)

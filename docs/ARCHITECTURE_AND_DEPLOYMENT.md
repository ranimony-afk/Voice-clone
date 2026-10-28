# VoiceForge architecture & deployment (post-reconciliation)

Date: 2026-10-23. Local branch was fast-forwarded from `73c9948` to current `origin/main` `65eec94fd799a5502a74a24ac7dd805f2d70e517` with `git merge --ff-only`; no conflict resolution or silent merge. M0 docs and ignored upstream clones were preserved.

## Current target topology

```text
Browser
  ├── static React/Vite UI on Vercel (no model weights, no GPU code)
  ├── HTTPS /api/* → separately hosted persistent Node API (Express)
  └── WSS /live-ws → separately hosted WebSocket API (same Node service currently;
                       separate process/host or managed WS service required at scale)

Persistent API (long-lived container/VM)
  ├── PostgreSQL (managed, TLS, migrations, PITR backups)
  ├── private S3-compatible object store (reference audio, prompts, generated media)
  ├── Redis/BullMQ (durable synthesis/render jobs; not implemented yet)
  └── internal HTTPS → long-lived OmniVoice GPU worker (services/omnivoice)
                       model loads once per worker, concurrency semaphore
```

Vercel is **frontend only**. Do not put OmniVoice in a Vercel function: large model weights,
accelerator allocation and warm resident model require a persistent worker. The API and WebSocket
endpoint need a separately hosted persistent service with a stable public hostname. The current
`server.ts` combines Express, Vite dev middleware and WebSockets; split/deploy it separately and
configure trusted CORS origins, authentication, request limits, TLS, readiness, and WebSocket origin
checks before production.

## Vercel frontend

- `vercel.json` builds `npm run build:client` and serves `dist/` as a static SPA.
- Set Vercel project env `VOICEFORGE_API_HOST` to the API hostname **without scheme/path**; verify
  Vercel's rewrite env interpolation in a preview deployment before relying on the API proxy. If
  the platform does not expand that variable in `destination`, use an explicit fixed API hostname
  in the config or a Vercel rewrite generated at deployment time. Do not expose inference-service
  credentials to browser env.
- Configure `CORS_ALLOWED_ORIGINS` on API to exact Vercel production/preview origins; never `*`
  with credentials. Vercel rewrite behavior for WebSockets is not presumed: configure the browser's
  secure `wss://` endpoint to the separate WebSocket hostname, and implement origin/auth checks.
- Browser API requests should stay relative (`/api/...`) when same-origin rewrite works; no browser
  call to localhost. Vercel smoke test must test both SPA and proxied API.

## Persistent API and GPU worker

- Node API: run built output via `npm run build && npm start`, bind `0.0.0.0`, set `NODE_ENV=production`,
  supply DB URL / auth secrets and exact CORS origins. Current API still needs migrations/auth/job
  queue work; its health response does **not** mean model readiness.
- Python worker: `services/omnivoice/Dockerfile.gpu` installs pinned `omnivoice==0.2.1` and
  torch/torchaudio 2.8.0; model weights download only at first warmup. Provide HF access only as a
  secret at build/runtime as required; capture upstream model-card license/terms before commercial
  use. Keep the worker on a private network and allow only authenticated API/worker traffic.
- Scale GPU worker count deliberately (one process/model per allocated GPU); do not scale CPU API
  instances by loading the model into each one. Worker concurrency defaults 1 to avoid OOM.
- Prompt `.pt` files and all media require private persistent object storage, encryption, owner-bound
  keys, expiry, deletion/revocation and backup policy. Current Python PromptStore is local disk and
  **not production persistence**.
- DB schema/migration scaffolding exists but route-level persistence/ownership, durable jobs, Redis,
  object storage, idempotency and signed upload/download URLs remain incomplete.

## Local smoke (no real model weights)

```bash
npm ci
npm run build
npm test
npm start                       # NODE_ENV=production PORT=3000
curl -f http://localhost:3000/healthz
cd services/omnivoice
python -m pip install -r requirements.lock
uvicorn app.main:app --host 0.0.0.0 --port 8100
curl -f http://localhost:8100/healthz
curl -s http://localhost:8100/v1/status  # model_available=false is expected without engine weights
```

A successful health probe only means process liveness. Readiness for synthesis requires model
availability and a GPU integration run that captures actual OmniVoice audio, metadata, sample rate,
duration, and evaluated language metrics. No deployment, external service, GPU, weights or production
data was used in this work.

#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3000}"
INFERENCE_BASE="${INFERENCE_BASE:-http://127.0.0.1:8100}"

curl --fail --silent --show-error "$API_BASE/healthz" >/dev/null
curl --fail --silent --show-error "$INFERENCE_BASE/healthz" >/dev/null
status="$(curl --fail --silent --show-error "$INFERENCE_BASE/v1/status")"
python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["engine"] == "omnivoice"; assert d["pinned_upstream_git"].startswith("08be0b4")' <<<"$status"
if [[ "${REQUIRE_NEURAL:-0}" == "1" ]]; then
  python3 - <<'PY'
import json, os, urllib.request
url = os.environ.get("INFERENCE_BASE", "http://127.0.0.1:8100") + "/v1/tts"
body = json.dumps({"text":"VoiceForge neural inference smoke test.","language":"en","num_step":8}).encode()
req = urllib.request.Request(url, body, {"Content-Type":"application/json"})
with urllib.request.urlopen(req, timeout=300) as r:
    data = json.load(r)
assert data["engine"] == "omnivoice" and data["engine_class"] == "neural"
assert data["sample_rate"] > 0 and data["duration_seconds"] > 0
open("/tmp/voiceforge-smoke.wav", "wb").write(__import__("base64").b64decode(data["audio_base64"]))
PY
fi
if [[ "${REQUIRE_NEURAL:-0}" == "1" ]]; then
  echo "Health and genuine neural synthesis smoke probes passed."
else
  echo "Health probes passed; neural synthesis was not requested (inspect /v1/status for model readiness)."
fi

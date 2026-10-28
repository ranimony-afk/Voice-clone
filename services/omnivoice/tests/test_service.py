from __future__ import annotations

import base64
import io
import os
import tempfile

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.audio_processing import analyze_reference, decode_audio, encode_wav
from app.config import ServiceConfig
from app.inference import CancelRegistry, PromptNotFoundError, PromptRevokedError, PromptStore, generate_speech
from app.model_manager import ModelManager, ModelUnavailableError, set_model_manager
from app.safety import ValidationError, clean_text, validate_generation_params, validate_instruct
from app.main import app


def make_wav(seconds: float = 5.0, sr: int = 24000, freq: float = 190.0) -> bytes:
    t = np.arange(int(seconds * sr), dtype=np.float32) / sr
    y = (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return encode_wav(y, sr)


def test_audio_decode_and_encode_are_real_pcm():
    wav = make_wav()
    samples, sr = decode_audio(wav)
    assert sr == 24000
    assert len(samples) == 120000
    assert np.std(samples) > 0.1


def test_reference_analyzer_measures_audio_and_duration():
    report = analyze_reference(make_wav(4.25))
    assert report.is_valid
    assert report.duration_seconds == 4.25
    assert report.peak_dbfs < 0
    assert report.analysis_engine == "libsndfile+numpy-deterministic"


def test_reference_longer_than_policy_limit_is_rejected_not_silently_trimmed():
    report = analyze_reference(make_wav(21.0), max_seconds=20.0)
    assert not report.is_valid
    assert any("rejects it" in x for x in report.feedback)


def test_silence_is_rejected():
    silent = encode_wav(np.zeros(24_000 * 5, dtype=np.float32), 24000)
    report = analyze_reference(silent)
    assert not report.is_valid
    assert any("silent" in x.lower() or "silence" in x.lower() for x in report.feedback)


def test_invalid_audio_is_not_guessed():
    with pytest.raises(Exception, match="Could not decode audio"):
        decode_audio(b"not-audio")


def test_text_normalization_and_limits():
    cleaned = clean_text("  hello\x00 world  ", max_chars=20)
    assert cleaned.text == "hello world"
    assert cleaned.warnings
    with pytest.raises(ValidationError, match="character limit"):
        clean_text("x" * 21, max_chars=20)


def test_generation_params_only_allow_verified_names():
    params = validate_generation_params({"num_step": 32, "speed": 1.1, "normalize_text": True})
    assert params == {"num_step": 32, "speed": 1.1, "normalize_text": True}
    with pytest.raises(ValidationError):
        validate_generation_params({"stability": 0.8})


def test_voice_design_supported_tokens_and_rejects_unknown():
    assert validate_instruct("female, young adult, indian accent") == []
    with pytest.raises(ValidationError, match="Unsupported"):
        validate_instruct("celebrity impression")


def test_model_manager_loads_once_with_injected_realistic_bundle():
    calls = []
    cfg = ServiceConfig(max_concurrency=1)
    def loader(_cfg):
        calls.append(1)
        return {"model": object(), "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000}
    manager = ModelManager(cfg, loader=loader)
    assert manager.status()["model_state"] == "not_loaded"
    assert manager.ensure_loaded()["device"] == "cuda:0"
    assert manager.status()["model_state"] == "loaded"
    assert manager.status()["dependencies_ready"] is True
    assert manager.ensure_loaded()["device"] == "cuda:0"
    assert len(calls) == 1


def test_model_manager_reports_loading_and_failed_states():
    import threading

    started = threading.Event()
    release = threading.Event()
    def blocking_loader(_cfg):
        started.set()
        assert release.wait(timeout=2)
        return {"model": object(), "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000}

    manager = ModelManager(ServiceConfig(), loader=blocking_loader)
    thread = threading.Thread(target=manager.ensure_loaded)
    thread.start()
    assert started.wait(timeout=1)
    assert manager.status()["model_state"] == "loading"
    release.set()
    thread.join(timeout=2)
    assert not thread.is_alive()
    assert manager.status()["model_state"] == "loaded"

    failed = ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("weights unavailable")))
    with pytest.raises(ModelUnavailableError, match="weights unavailable"):
        failed.ensure_loaded()
    assert failed.status()["model_state"] == "failed"
    assert failed.status()["dependencies_ready"] is False


def test_generation_calls_upstream_generate_and_encodes_actual_returned_samples():
    class FakeModel:
        def __init__(self):
            self.kwargs = None
        def generate(self, **kwargs):
            self.kwargs = kwargs
            return [np.full(2400, 0.125, dtype=np.float32)]
    model = FakeModel()
    manager = ModelManager(ServiceConfig(), loader=lambda _cfg: {
        "model": model, "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000,
        "omnivoice_version": "0.2.1", "torch": None,
    })
    cfg = ServiceConfig()
    with tempfile.TemporaryDirectory() as temp:
        result = generate_speech(manager, PromptStore(temp), CancelRegistry(),
                                 __import__("app.schemas", fromlist=["TTSRequest"]).TTSRequest(
                                     text="hello", language="en", num_step=8, speed=1.0), cfg)
    assert model.kwargs["text"] == "hello"
    assert model.kwargs["language"] == "en"
    assert model.kwargs["num_step"] == 8
    assert result.sample_rate == 24000
    assert result.duration_seconds == 0.1
    samples, sr = decode_audio(result.wav_bytes)
    assert sr == 24000 and np.allclose(samples, 0.125, atol=1e-4)


def test_model_manager_serializes_concurrent_first_loads():
    import threading, time
    calls = []
    cfg = ServiceConfig(max_concurrency=2)
    def loader(_cfg):
        calls.append(1)
        time.sleep(0.02)
        return {"model": object(), "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000}
    manager = ModelManager(cfg, loader=loader)
    results = []
    threads = [threading.Thread(target=lambda: results.append(manager.ensure_loaded())) for _ in range(5)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert len(results) == 5
    assert len(calls) == 1


def test_model_manager_unavailable_is_not_a_fake_output():
    manager = ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("weights blocked")))
    with pytest.raises(ModelUnavailableError, match="weights blocked"):
        manager.ensure_loaded()


def test_prompt_store_revocation_destroys_tensor_and_blocks_load():
    class FakePrompt:
        def save(self, path):
            with open(path, "wb") as f:
                f.write(b"private tensor")
    with tempfile.TemporaryDirectory() as temp:
        store = PromptStore(temp)
        store.save("prompt-a", FakePrompt(), ref_text_present=False, ref_duration=5, sample_rate=24000, model_id="test", analysis={})
        assert store.exists("prompt-a")
        assert store.revoke("prompt-a")["revoked"]
        assert not store.exists("prompt-a")
        with pytest.raises(PromptRevokedError):
            store.load_prompt("prompt-a")


def test_cancel_registry_is_cooperative_and_clearable():
    c = CancelRegistry()
    c.cancel("job-1")
    assert c.is_cancelled("job-1")
    c.clear("job-1")
    assert not c.is_cancelled("job-1")


def test_status_and_readiness_are_honest_without_weights():
    set_model_manager(ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("no accelerator"))))
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        before_load = client.get("/readyz")
        assert before_load.status_code == 503
        assert before_load.json()["process_live"] is True
        assert before_load.json()["analysis_ready"] is True
        assert before_load.json()["model_state"] == "not_loaded"
        assert before_load.json()["neural_inference_ready"] is False
        status = client.get("/v1/status").json()
        assert status["model_available"] is False
        assert status["model_state"] == "not_loaded"
        assert status["pinned_upstream_git"].startswith("08be0b4")
        r = client.post("/v1/tts", json={"text": "Hello", "language": "en"})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "ENGINE_UNAVAILABLE"
        assert "audio_base64" not in r.json()
        after_failure = client.get("/readyz")
        assert after_failure.status_code == 503
        assert after_failure.json()["model_state"] == "failed"
        assert after_failure.json()["neural_inference_ready"] is False


def test_readyz_stays_unready_during_loading_then_becomes_ready():
    import threading

    started = threading.Event()
    release = threading.Event()

    def blocking_loader(_cfg):
        started.set()
        assert release.wait(timeout=2)
        return {"model": object(), "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000}

    manager = ModelManager(ServiceConfig(), loader=blocking_loader)
    set_model_manager(manager)
    thread = threading.Thread(target=manager.ensure_loaded)
    try:
        with TestClient(app) as client:
            thread.start()
            assert started.wait(timeout=1)
            loading = client.get("/readyz")
            assert loading.status_code == 503
            assert loading.json()["model_state"] == "loading"
            assert loading.json()["dependencies_ready"] is None
            assert loading.json()["neural_inference_ready"] is False

            release.set()
            thread.join(timeout=2)
            assert not thread.is_alive()
            loaded = client.get("/readyz")
            assert loaded.status_code == 200
            assert loaded.json()["model_state"] == "loaded"
            assert loaded.json()["dependencies_ready"] is True
            assert loaded.json()["neural_inference_ready"] is True
    finally:
        release.set()
        if thread.is_alive():
            thread.join(timeout=2)
        set_model_manager(ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("not loaded"))))


@pytest.mark.parametrize("dependencies_ready", [None, False])
def test_readyz_rejects_loaded_but_inconsistent_dependency_state(dependencies_ready):
    class ContradictoryManager:
        def status(self):
            return {
                "model_state": "loaded",
                "model_loaded": True,
                "dependencies_ready": dependencies_ready,
            }

    set_model_manager(ContradictoryManager())
    try:
        with TestClient(app) as client:
            response = client.get("/readyz")
            assert response.status_code == 503
            assert response.json()["neural_inference_ready"] is False
    finally:
        set_model_manager(ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("not loaded"))))


def test_readyz_returns_neural_ready_only_after_model_is_loaded():
    manager = ModelManager(ServiceConfig(), loader=lambda _cfg: {
        "model": object(), "device": "cuda:0", "dtype": "float16", "sampling_rate": 24000,
    })
    set_model_manager(manager)
    try:
        with TestClient(app) as client:
            before = client.get("/readyz")
            assert before.status_code == 503
            assert before.json()["model_state"] == "not_loaded"
            manager.ensure_loaded()
            ready = client.get("/readyz")
            assert ready.status_code == 200
            assert ready.json()["ready"] is True
            assert ready.json()["neural_inference_ready"] is True
            assert ready.json()["model_state"] == "loaded"
    finally:
        set_model_manager(ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("not loaded"))))


def test_worker_auth_blocks_direct_model_and_prompt_calls_before_loading(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("VOICEFORGE_WORKER_API_KEY", "test-secret")
    loads = []
    manager = ModelManager(ServiceConfig(), loader=lambda _cfg: loads.append("load"))
    set_model_manager(manager)
    monkeypatch.delenv("VOICEFORGE_WORKER_API_KEY", raising=False)
    with TestClient(app) as client:
        missing_secret = client.post("/v1/tts", json={"text": "hello"})
        assert missing_secret.status_code == 503
        assert missing_secret.json()["error"]["code"] == "WORKER_AUTH_NOT_CONFIGURED"
        monkeypatch.setenv("VOICEFORGE_WORKER_API_KEY", "test-secret")
        denied = [
            client.post("/v1/tts", json={"text": "hello"}),
            client.post("/v1/model/warmup"),
            client.post("/v1/tts/cancel/test-token"),
            client.post("/v1/clone/prompts", json={}),
            client.get("/v1/clone/prompts/private-prompt"),
            client.delete("/v1/clone/prompts/private-prompt"),
        ]
        assert [response.status_code for response in denied] == [401] * len(denied)
        wrong_key = client.post("/v1/tts", headers={"x-worker-api-key": "wrong"}, json={"text": "hello"})
        assert wrong_key.status_code == 401
        assert loads == []
        assert manager.status()["model_state"] == "not_loaded"
        assert client.get("/healthz").status_code == 200
    set_model_manager(ModelManager(ServiceConfig(), loader=lambda _cfg: (_ for _ in ()).throw(ModelUnavailableError("not loaded"))))


def test_reference_analysis_endpoint_accepts_real_wav():
    with TestClient(app) as client:
        encoded = base64.b64encode(make_wav()).decode("ascii")
        response = client.post("/v1/reference/analyze", json={"audio_base64": encoded})
        assert response.status_code == 200
        assert response.json()["analysis"]["duration_seconds"] == 5.0


def test_tts_rejects_unverified_parameter_names():
    with TestClient(app) as client:
        response = client.post("/v1/tts", json={"text": "hello", "stability": 0.5})
        assert response.status_code == 422


def test_prompt_store_path_traversal_rejected():
    with tempfile.TemporaryDirectory() as temp:
        store = PromptStore(temp)
        with pytest.raises(PromptNotFoundError):
            store.exists("../escape")

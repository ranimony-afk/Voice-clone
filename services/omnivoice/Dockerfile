# Multi-stage production Dockerfile for VoiceForge OmniVoice Inference Service
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMNIVOICE_MODEL_ID="k2-fsa/OmniVoice" \
    PORT=8001

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    python3-dev \
    ffmpeg \
    libsndfile1 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --upgrade pip setuptools wheel

# Install PyTorch with CUDA 12.8 support
RUN pip3 install --no-cache-dir \
    torch==2.8.0 \
    torchaudio==2.8.0 \
    --index-url https://download.pytorch.org/whl/cu128

# Install dependencies and OmniVoice package
COPY pyproject.toml .
RUN pip3 install --no-cache-dir -e .

COPY app/ ./app/

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8001/health/live || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]

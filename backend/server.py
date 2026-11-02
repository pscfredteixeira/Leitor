"""Servidor do Leitor: Kokoro 82M, narração em português brasileiro.

Recebe apenas trechos de texto, não os PDFs/EPUBs originais.
"""
from __future__ import annotations

import io
import hmac
import logging
import os
import threading
import wave
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger("leitor.kokoro")
app = FastAPI(title="Leitor — Kokoro PT-BR", version="1.0.0")
origins = os.getenv(
    "CORS_ORIGINS",
    "https://pscfredteixeira.github.io,http://localhost:8080,http://127.0.0.1:8080,http://127.0.0.1:5500",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in origins.split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Leitor-Key"],
)

VOICES = {
    "pf_dora": "Dora — feminina",
    "pm_alex": "Alex — masculina",
    "pm_santa": "Santa — masculina",
}
SAMPLE_RATE = 24000
_pipeline_lock = threading.Lock()


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=400)
    voice: str = Field(default="pf_dora")
    speed: float = Field(default=1.0, ge=0.7, le=1.5)


@lru_cache(maxsize=1)
def get_pipeline():
    # espeak-ng é essencial para a fonemização em português.
    from kokoro import KPipeline
    logger.info("Inicializando Kokoro em pt-BR.")
    return KPipeline(lang_code="p", repo_id="hexgrad/Kokoro-82M")


def synthesize(payload: SpeechRequest) -> bytes:
    # Evita geração concorrente e consumo excessivo de memória.
    with _pipeline_lock:
        pipeline = get_pipeline()
        buffers = []
        for result in pipeline(payload.text.strip(), voice=payload.voice, speed=payload.speed):
            chunk = result.audio
            if chunk is None:
                continue
            if hasattr(chunk, "detach"):
                chunk = chunk.detach().cpu().numpy()
            buffers.append(np.asarray(chunk, dtype=np.float32).reshape(-1))
        if not buffers:
            raise ValueError("O Kokoro não retornou áudio para este trecho.")
        combined = np.concatenate(buffers)
        pcm = np.int16(np.clip(combined, -1.0, 1.0) * 32767)
        stream = io.BytesIO()
        with wave.open(stream, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm.tobytes())
        return stream.getvalue()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engine": "kokoro",
        "language": "pt-BR",
        "loaded": get_pipeline.cache_info().currsize > 0,
        "voices": VOICES,
        "warning": "O primeiro áudio pode exigir download e inicialização do modelo.",
    }


@app.post("/api/tts")
async def create_speech(payload: SpeechRequest, x_leitor_key: str | None = Header(default=None)):
    expected_key = os.getenv("LEITOR_API_KEY", "").strip()
    if expected_key and not hmac.compare_digest(x_leitor_key or "", expected_key):
        raise HTTPException(status_code=401, detail="Chave de acesso ao Kokoro inválida.")
    if payload.voice not in VOICES:
        raise HTTPException(422, "Voz desconhecida. Use pf_dora, pm_alex ou pm_santa.")
    if not payload.text.strip():
        raise HTTPException(422, "Envie um texto não vazio.")
    try:
        wav = await run_in_threadpool(synthesize, payload)
    except Exception:
        logger.exception("Falha na geração neural")
        raise HTTPException(
            status_code=503,
            detail="Não foi possível gerar a narração. Confira o modelo e os logs do servidor.",
        )
    return Response(
        wav,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )

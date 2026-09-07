import os
import json
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel


app = FastAPI(title="Solmate Piper HTTP")


def env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default


PIPER_COMMAND = env("PIPER_COMMAND", "piper")
PIPER_MODEL_PATH = env(
    "PIPER_MODEL_PATH",
    "/models/piper/en_GB-northern_english_male-medium.onnx",
)
PIPER_VOICE_CATALOG_PATH = env(
    "PIPER_VOICE_CATALOG_PATH",
    "/models/piper/models.json",
)
PIPER_DEFAULT_VOICE_ID = os.environ.get("PIPER_DEFAULT_VOICE_ID")
PIPER_TIMEOUT_SECONDS = int(env("PIPER_TIMEOUT_SECONDS", "30"))


class SynthesizeRequest(BaseModel):
    text: str
    voiceId: str | None = None
    speed: float | None = None


def load_voice_catalog() -> dict | None:
    catalog_path = Path(PIPER_VOICE_CATALOG_PATH)

    if not catalog_path.exists():
        return None

    return json.loads(catalog_path.read_text(encoding="utf-8"))


def resolve_model_path(voice_id: str | None = None) -> Path:
    catalog = load_voice_catalog()

    if catalog:
        selected_voice_id = voice_id or PIPER_DEFAULT_VOICE_ID or catalog.get("defaultVoiceId")
        voices = catalog.get("voices", [])

        for voice in voices:
            if voice.get("id") == selected_voice_id:
                model_path = Path(voice["modelPath"])

                if not model_path.is_absolute():
                    model_path = Path(PIPER_VOICE_CATALOG_PATH).parent / model_path

                return model_path.resolve()

        if voice_id:
            raise HTTPException(
                status_code=400,
                detail=f"unknown voiceId: {voice_id}",
            )

    return Path(PIPER_MODEL_PATH)


def validate_model(model_path: Path) -> None:
    config_path = Path(f"{model_path}.json")

    if not model_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"model not found: {model_path}",
        )

    if not config_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"model config not found: {config_path}",
        )


@app.get("/health")
def health() -> dict[str, str]:
    model_path = resolve_model_path()
    validate_model(model_path)

    return {"status": "ready", "model": str(model_path)}


@app.get("/voices")
def voices() -> dict:
    catalog = load_voice_catalog()

    if not catalog:
        return {
            "defaultVoiceId": PIPER_DEFAULT_VOICE_ID,
            "voices": [],
        }

    return catalog


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    model_path = resolve_model_path(request.voiceId)
    validate_model(model_path)

    text = request.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp:
        output_path = temp.name

    try:
        result = subprocess.run(
            [
                PIPER_COMMAND,
                "--model",
                str(model_path),
                "--output_file",
                output_path,
            ]
            + (["--length_scale", str(1 / request.speed)] if request.speed and request.speed > 0 else []),
            input=text,
            check=False,
            capture_output=True,
            text=True,
            timeout=PIPER_TIMEOUT_SECONDS,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=result.stderr.strip() or "piper synthesis failed",
            )

        wav = Path(output_path).read_bytes()
        return Response(content=wav, media_type="audio/wav")
    finally:
        Path(output_path).unlink(missing_ok=True)

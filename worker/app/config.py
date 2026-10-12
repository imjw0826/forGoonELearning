import os
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


SUPABASE_URL = _env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _env("SUPABASE_SERVICE_ROLE_KEY")
FAL_KEY = _env("FAL_KEY")
WHISPER_LANGUAGE = _env("WHISPER_LANGUAGE")
DEEPSEEK_API_KEY = _env("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL = _env("DEEPSEEK_MODEL", "deepseek-chat")
# Overridable for local testing.
FAL_QUEUE_URL = _env("FAL_QUEUE_URL", "https://queue.fal.run").rstrip("/")
DEEPSEEK_BASE_URL = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
# Shared with the Vercel app: authenticates job requests and signs browser upload tokens.
WORKER_SECRET = _env("WORKER_SECRET")
ALLOWED_ORIGINS = [o.strip() for o in _env("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

DATA_DIR = Path(_env("DATA_DIR", "/data"))
UPLOAD_DIR = DATA_DIR / "uploads"

AUDIO_BUCKET = "audio"
MATERIALS_BUCKET = "materials"

CORRECT_CONCURRENCY = 4
SECTION_CONCURRENCY = 3
MAX_CHUNKS_PER_SECTION = 6
MAX_PART_BYTES = 8 * 1024 * 1024
MAX_MEDIA_BYTES = 2 * 1024 ** 3
MAX_PARTS = MAX_MEDIA_BYTES // MAX_PART_BYTES
MAX_AUDIO_BYTES = 45 * 1024 * 1024
CONVERSION_TIMEOUT_SEC = 2 * 60 * 60


def missing() -> list[str]:
    """Names of required settings that are not configured yet."""
    required = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
        "FAL_KEY": FAL_KEY,
        "DEEPSEEK_API_KEY": DEEPSEEK_API_KEY,
        "WORKER_SECRET": WORKER_SECRET,
    }
    return [k for k, v in required.items() if not v]


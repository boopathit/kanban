from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    SESSION_SECRET: str = "dev-insecure-change-me"
    OPENROUTER_API_KEY: str = ""
    DB_PATH: Path = Path("/app/data/pm.db")
    STATIC_DIR: Path = BACKEND_DIR / "static"


def get_settings() -> Settings:
    return Settings()

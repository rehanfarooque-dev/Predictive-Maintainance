"""Backend settings (env-overridable via PDM_ prefix)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PDM_", env_file=".env")

    config_path: str = "config.yaml"
    default_threshold: float = 0.5
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()

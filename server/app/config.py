from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 3001
    database_url: str = "postgresql://arena:change-me@127.0.0.1:5432/player_arena"
    cors_origins: str = "http://localhost:5173"
    txline_api_base: str = "https://txline.txodds.com"
    txline_api_token: str = ""
    txline_guest_jwt: str = ""
    txline_competition_id: str = ""
    txline_network: str = "devnet"
    openligadb_base: str = "https://api.openligadb.de"
    allow_demo_data: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

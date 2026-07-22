from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root = parents[2] from src/leadagent/settings.py
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    apify_token: str = ""
    apify_daily_budget_usd: float = 5.0
    apify_dry_run: bool = True
    # Free website search + site scrape for phone/email (no Apify)
    enrich_free_discovery: bool = True

    leadagent_db: Path = Field(default=REPO_ROOT / "data" / "leadagent.db")
    leadagent_config_dir: Path = Field(default=REPO_ROOT / "config")

    brave_cdp_url: str = "http://127.0.0.1:9222"
    brave_user_data_dir: str = ""

    daily_send_cap: int = 25
    require_send_confirmation: bool = True

    # FloGuard CRM shared leads store (/api/academy-leads on Vercel project floguard-crm)
    academy_sync_url: str = "https://crm.floguardfl.com/api/academy-leads"
    academy_sync_secret: str = ""

    @property
    def playbooks_path(self) -> Path:
        return self.leadagent_config_dir / "playbooks.yaml"

    @property
    def enrichment_path(self) -> Path:
        return self.leadagent_config_dir / "enrichment.yaml"

    @property
    def channels_path(self) -> Path:
        return self.leadagent_config_dir / "channels.yaml"

    @property
    def exports_dir(self) -> Path:
        return REPO_ROOT / "data" / "exports"


def get_settings() -> Settings:
    return Settings()

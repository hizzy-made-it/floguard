from __future__ import annotations

from typing import Any

import httpx

from leadagent.settings import Settings


class ApifyClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base = "https://api.apify.com/v2"

    @property
    def dry_run(self) -> bool:
        return self.settings.apify_dry_run or not self.settings.apify_token

    def run_actor(
        self, actor_id: str, run_input: dict[str, Any], timeout_secs: int = 120
    ) -> list[dict[str, Any]]:
        if self.dry_run:
            return []

        token = self.settings.apify_token
        # actor_id like "compass/crawler-google-places" → path compass~crawler-google-places
        actor_path = actor_id.replace("/", "~")
        url = f"{self.base}/acts/{actor_path}/run-sync-get-dataset-items"
        with httpx.Client(timeout=timeout_secs + 30) as client:
            r = client.post(
                url,
                params={"token": token, "timeout": timeout_secs},
                json=run_input,
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                return data
            return []

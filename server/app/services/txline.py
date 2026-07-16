from typing import Any

import httpx

from ..config import Settings


async def fetch_txline_matches(settings: Settings) -> list[dict[str, Any]] | None:
    if not settings.txline_api_token:
        return None

    base = settings.txline_api_base.rstrip("/")
    params: dict[str, str] = {}
    if settings.txline_network:
        params["network"] = settings.txline_network

    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.get(
            f"{base}/api/fixtures/snapshot",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {settings.txline_api_token}",
            },
            params=params,
        )

    if response.status_code >= 400:
        return None

    payload = response.json()
    items = payload if isinstance(payload, list) else payload.get("data", [])
    matches = [mapped for item in items if (mapped := map_txline_fixture(item))]
    return matches or None


def map_txline_fixture(item: dict[str, Any]) -> dict[str, Any] | None:
    fixture_id = str(item.get("fixtureId") or item.get("id") or "")
    home = item.get("homeTeam") or item.get("home")
    away = item.get("awayTeam") or item.get("away")
    if not fixture_id or not home or not away:
        return None

    status = normalize_status(str(item.get("status") or ""))
    score = item.get("score") or {home: 0, away: 0}

    return {
        "id": fixture_id,
        "home": home,
        "away": away,
        "homeCode": home[:3].upper(),
        "awayCode": away[:3].upper(),
        "minute": str(item.get("minute") or ("FT" if status == "FINAL" else "0'")),
        "status": status,
        "score": score,
        "stats": {
            home: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
            away: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
        },
        "ratings": {},
        "mom": home,
        "source": "txline",
        "oracleProof": f"txline:{fixture_id}",
        "events": [],
    }


def normalize_status(value: str) -> str:
    status = value.lower()
    if "final" in status or "finished" in status:
        return "FINAL"
    if "live" in status or "running" in status or "inplay" in status:
        return "LIVE"
    return "SCHEDULED"

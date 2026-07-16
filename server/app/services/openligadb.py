from typing import Any

import httpx

from ..config import Settings


async def fetch_openligadb_matches(settings: Settings) -> list[dict[str, Any]] | None:
    base = settings.openligadb_base.rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(f"{base}/getmatchdata/wm/2022", headers={"Accept": "application/json"})
        if response.status_code >= 400:
            return None
        payload = response.json()
    except httpx.HTTPError:
        return None

    matches = [mapped for item in payload[:12] if (mapped := map_openligadb_match(item))]
    return matches or None


def map_openligadb_match(item: dict[str, Any]) -> dict[str, Any] | None:
    home = item.get("team1", {}).get("teamName")
    away = item.get("team2", {}).get("teamName")
    if not home or not away:
        return None

    results = item.get("matchResults") or []
    final_result = next((result for result in results if result.get("resultTypeID") == 2), results[-1] if results else {})
    home_goals = int(final_result.get("pointsTeam1") or 0)
    away_goals = int(final_result.get("pointsTeam2") or 0)

    return {
        "id": f"openligadb-{item['matchID']}",
        "home": home,
        "away": away,
        "homeCode": item.get("team1", {}).get("shortName") or home[:3].upper(),
        "awayCode": item.get("team2", {}).get("shortName") or away[:3].upper(),
        "minute": "FT" if item.get("matchIsFinished") else "0'",
        "status": "FINAL" if item.get("matchIsFinished") else "SCHEDULED",
        "score": {home: home_goals, away: away_goals},
        "stats": {
            home: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
            away: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
        },
        "ratings": {},
        "mom": home,
        "source": "openligadb",
        "events": [],
    }

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import Settings


async def hydrate_api_football_details(
    client: httpx.AsyncClient,
    settings: Settings,
    matches: list[dict[str, Any]],
) -> None:
    if not settings.api_football_key:
        return

    base = settings.api_football_base.rstrip("/")
    headers = {"Accept": "application/json", "x-apisports-key": settings.api_football_key}
    fixtures_by_date: dict[str, list[dict[str, Any]]] = {}

    for match in matches[:8]:
        match_date = api_match_date(match.get("startTime"))
        if not match_date:
            continue
        if match_date not in fixtures_by_date:
            fixtures_by_date[match_date] = await fetch_fixtures_for_date(base, headers, settings, match_date, client)
        candidate = find_matching_fixture(fixtures_by_date[match_date], match)
        if not candidate:
            continue
        candidate_id = ((candidate.get("fixture") or {}) if isinstance(candidate.get("fixture"), dict) else {}).get("id")
        if candidate_id:
            detailed_candidate = await fetch_fixture_bundle(base, headers, str(candidate_id), client)
            if detailed_candidate:
                candidate = detailed_candidate
        apply_fixture_details(match, candidate)
        transfers = await fetch_match_transfers(base, headers, candidate, client)
        if transfers:
            match["transfers"] = transfers


async def fetch_fixtures_for_date(
    base: str,
    headers: dict[str, str],
    settings: Settings,
    match_date: str,
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    params = {
        "date": match_date,
        "league": settings.api_football_league_id,
        "season": settings.api_football_season,
    }
    try:
        response = await client.get(f"{base}/fixtures", headers=headers, params=params, timeout=8)
        if response.status_code >= 400:
            return []
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    items = payload.get("response", []) if isinstance(payload, dict) else []
    return [item for item in items if isinstance(item, dict)]


async def fetch_fixture_by_id(
    base: str,
    headers: dict[str, str],
    fixture_id: str,
    client: httpx.AsyncClient,
) -> dict[str, Any] | None:
    try:
        response = await client.get(f"{base}/fixtures", headers=headers, params={"id": fixture_id}, timeout=8)
        if response.status_code >= 400:
            return None
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    items = payload.get("response", []) if isinstance(payload, dict) else []
    first = items[0] if isinstance(items, list) and items else None
    return first if isinstance(first, dict) else None


async def fetch_fixture_bundle(
    base: str,
    headers: dict[str, str],
    fixture_id: str,
    client: httpx.AsyncClient,
) -> dict[str, Any] | None:
    fixture = await fetch_fixture_by_id(base, headers, fixture_id, client)
    if not fixture:
        return None

    lineups, statistics, events, players = await asyncio.gather(
        fetch_fixture_collection(base, headers, "fixtures/lineups", {"fixture": fixture_id}, client),
        fetch_fixture_collection(base, headers, "fixtures/statistics", {"fixture": fixture_id}, client),
        fetch_fixture_collection(base, headers, "fixtures/events", {"fixture": fixture_id}, client),
        fetch_fixture_collection(base, headers, "fixtures/players", {"fixture": fixture_id}, client),
    )
    if lineups:
        fixture["lineups"] = lineups
    if statistics:
        fixture["statistics"] = statistics
    if events:
        fixture["events"] = events
    if players:
        fixture["players"] = players
    return fixture


async def fetch_fixture_collection(
    base: str,
    headers: dict[str, str],
    endpoint: str,
    params: dict[str, str],
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    try:
        response = await client.get(f"{base}/{endpoint}", headers=headers, params=params, timeout=8)
        if response.status_code >= 400:
            return []
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    items = payload.get("response", []) if isinstance(payload, dict) else []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


async def fetch_match_transfers(
    base: str,
    headers: dict[str, str],
    fixture: dict[str, Any],
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    teams = fixture.get("teams", {}) if isinstance(fixture.get("teams"), dict) else {}
    team_ids = [
        ((teams.get(side) or {}) if isinstance(teams.get(side), dict) else {}).get("id")
        for side in ["home", "away"]
    ]
    team_ids = [str(team_id) for team_id in team_ids if team_id]
    if not team_ids:
        return []

    batches = await asyncio.gather(
        *(fetch_transfers_for_team(base, headers, team_id, client) for team_id in team_ids),
    )
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for batch in batches:
        for item in batch:
            key = "|".join(
                str(item.get(part) or "")
                for part in ["playerName", "date", "type", "fromTeam", "toTeam"]
            )
            if key in seen:
                continue
            seen.add(key)
            output.append(item)
    return sorted(output, key=lambda item: str(item.get("date") or ""), reverse=True)[:6]


async def fetch_transfers_for_team(
    base: str,
    headers: dict[str, str],
    team_id: str,
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    try:
        response = await client.get(f"{base}/transfers", headers=headers, params={"team": team_id}, timeout=8)
        if response.status_code >= 400:
            return []
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    items = payload.get("response", []) if isinstance(payload, dict) else []
    output: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return output
    for item in items:
        if not isinstance(item, dict):
            continue
        player = item.get("player") if isinstance(item.get("player"), dict) else {}
        for transfer in item.get("transfers", []):
            if not isinstance(transfer, dict):
                continue
            teams = transfer.get("teams") if isinstance(transfer.get("teams"), dict) else {}
            out_team = teams.get("out") if isinstance(teams.get("out"), dict) else {}
            in_team = teams.get("in") if isinstance(teams.get("in"), dict) else {}
            player_name = player.get("name")
            if not player_name:
                continue
            output.append(
                {
                    "playerName": player_name,
                    "date": transfer.get("date"),
                    "type": transfer.get("type") or "Transfer",
                    "fromTeam": out_team.get("name") or "",
                    "toTeam": in_team.get("name") or "",
                    "source": "api-football",
                }
            )
    return output


def find_matching_fixture(fixtures: list[dict[str, Any]], match: dict[str, Any]) -> dict[str, Any] | None:
    home = normalize_team_name(match.get("home"))
    away = normalize_team_name(match.get("away"))
    for fixture in fixtures:
        teams = fixture.get("teams", {}) if isinstance(fixture.get("teams"), dict) else {}
        candidate_home = normalize_team_name((teams.get("home") or {}).get("name"))
        candidate_away = normalize_team_name((teams.get("away") or {}).get("name"))
        if candidate_home == home and candidate_away == away:
            return fixture
        if candidate_home == away and candidate_away == home:
            return fixture
    return None


def apply_fixture_details(match: dict[str, Any], fixture: dict[str, Any]) -> None:
    fixture_meta = fixture.get("fixture", {}) if isinstance(fixture.get("fixture"), dict) else {}
    teams = fixture.get("teams", {}) if isinstance(fixture.get("teams"), dict) else {}
    goals = fixture.get("goals", {}) if isinstance(fixture.get("goals"), dict) else {}

    api_fixture_id = fixture_meta.get("id")
    if api_fixture_id:
        match["detailProviderFixtureId"] = str(api_fixture_id)
    match["detailSource"] = "api-football"
    venue = fixture_meta.get("venue") if isinstance(fixture_meta.get("venue"), dict) else {}
    if venue.get("name"):
        match["venueName"] = venue.get("name")
    if venue.get("city"):
        match["venueCity"] = venue.get("city")

    home_team = teams.get("home") or {}
    away_team = teams.get("away") or {}
    if not match.get("homeLogoUrl") and isinstance(home_team, dict):
        match["homeLogoUrl"] = home_team.get("logo")
    if not match.get("awayLogoUrl") and isinstance(away_team, dict):
        match["awayLogoUrl"] = away_team.get("logo")

    status = normalize_api_status((fixture_meta.get("status") or {}).get("short"))
    if status:
        match["status"] = status
        match["minute"] = normalize_api_minute(fixture_meta.get("status"), status)

    home_score = goals.get("home")
    away_score = goals.get("away")
    if home_score is not None and away_score is not None:
        match["score"] = {match["home"]: safe_int(home_score), match["away"]: safe_int(away_score)}

    lineups = map_lineups(fixture.get("lineups"), match)
    if lineups:
        match["lineups"] = lineups

    stats = map_statistics(fixture.get("statistics"), match)
    if stats:
        match["stats"] = stats

    events = map_events(fixture.get("events"), match)
    if events:
        match["events"] = events

    ratings = map_player_ratings(fixture.get("players"))
    if ratings:
        match["ratings"] = ratings
        match["mom"] = max(ratings.items(), key=lambda item: item[1])[0]


def map_lineups(value: Any, match: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}

    output: dict[str, Any] = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        team = item.get("team") if isinstance(item.get("team"), dict) else {}
        team_name = str(team.get("name") or "")
        mapped_name = match_team_name(team_name, match)
        if not mapped_name:
            continue
        side = "home" if mapped_name == match["home"] else "away"
        output[mapped_name] = {
            "formation": item.get("formation"),
            "starters": [map_lineup_player(row, side) for row in item.get("startXI", []) if isinstance(row, dict)],
            "bench": [map_lineup_player(row, side) for row in item.get("substitutes", []) if isinstance(row, dict)],
        }
    return output


def map_lineup_player(row: dict[str, Any], side: str) -> dict[str, Any]:
    player = row.get("player") if isinstance(row.get("player"), dict) else {}
    mapped = {
        "id": str(player.get("id") or ""),
        "name": player.get("name") or "Unknown player",
        "number": safe_int_or_none(player.get("number")),
        "position": player.get("pos"),
        "photoUrl": player.get("photo"),
    }
    grid = str(player.get("grid") or "")
    coords = lineup_grid_to_xy(grid, side)
    if coords:
        mapped.update(coords)
    return {key: value for key, value in mapped.items() if value not in (None, "")}


def map_statistics(value: Any, match: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, list):
        return {}

    raw: dict[str, dict[str, Any]] = {}
    for team_stats in value:
        if not isinstance(team_stats, dict):
            continue
        team = team_stats.get("team") if isinstance(team_stats.get("team"), dict) else {}
        mapped_name = match_team_name(str(team.get("name") or ""), match)
        if not mapped_name:
            continue
        raw[mapped_name] = {
            normalize_stat_name(stat.get("type")): stat.get("value")
            for stat in team_stats.get("statistics", [])
            if isinstance(stat, dict)
        }

    if not raw:
        return {}

    home_raw = raw.get(match["home"], {})
    away_raw = raw.get(match["away"], {})
    home_corners = safe_int(home_raw.get("corner kicks"))
    away_corners = safe_int(away_raw.get("corner kicks"))
    home_shots = safe_int(home_raw.get("total shots"))
    away_shots = safe_int(away_raw.get("total shots"))
    return {
        match["home"]: {
            "possession": parse_percent(home_raw.get("ball possession")),
            "shotsAgainst": away_shots,
            "cornersAgainst": away_corners,
        },
        match["away"]: {
            "possession": parse_percent(away_raw.get("ball possession")),
            "shotsAgainst": home_shots,
            "cornersAgainst": home_corners,
        },
    }


def map_events(value: Any, match: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    output: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or str(item.get("type") or "").lower() != "goal":
            continue
        team = item.get("team") if isinstance(item.get("team"), dict) else {}
        player = item.get("player") if isinstance(item.get("player"), dict) else {}
        time = item.get("time") if isinstance(item.get("time"), dict) else {}
        team_name = match_team_name(str(team.get("name") or ""), match) or match["home"]
        minute = safe_int(time.get("elapsed")) + safe_int(time.get("extra"))
        tags = []
        detail = str(item.get("detail") or "").lower()
        comments = str(item.get("comments") or "").lower()
        if "penalty" in detail or "penalty" in comments:
            tags.append("penalty")
        if minute > 90:
            tags.append("extra-time")
        output.append(
            {
                "type": "goal",
                "team": team_name,
                "player": player.get("name") or "Unknown player",
                "minute": minute,
                "tags": tags,
            }
        )
    return output


def map_player_ratings(value: Any) -> dict[str, float]:
    if not isinstance(value, list):
        return {}
    ratings: dict[str, float] = {}
    for team in value:
        if not isinstance(team, dict):
            continue
        for item in team.get("players", []):
            if not isinstance(item, dict):
                continue
            player = item.get("player") if isinstance(item.get("player"), dict) else {}
            stats = item.get("statistics", [])
            if not isinstance(stats, list) or not stats:
                continue
            games = stats[0].get("games") if isinstance(stats[0], dict) and isinstance(stats[0].get("games"), dict) else {}
            rating = safe_float(games.get("rating"))
            name = player.get("name")
            if name and rating:
                ratings[str(name)] = rating
    return ratings


def api_match_date(value: Any) -> str | None:
    if not value:
        return None
    try:
        if isinstance(value, (int, float)):
            date = datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return date.date().isoformat()


def normalize_api_status(value: Any) -> str | None:
    raw = str(value or "").upper()
    if raw in {"FT", "AET", "PEN"}:
        return "FINAL"
    if raw in {"1H", "HT", "2H", "ET", "BT", "P"}:
        return "LIVE"
    if raw in {"NS", "TBD"}:
        return "SCHEDULED"
    return None


def normalize_api_minute(status: Any, normalized: str) -> str:
    if normalized == "FINAL":
        return "FT"
    if normalized == "SCHEDULED":
        return "0'"
    if isinstance(status, dict) and status.get("elapsed"):
        return f"{status['elapsed']}'"
    return "LIVE"


def match_team_name(value: str, match: dict[str, Any]) -> str | None:
    normalized = normalize_team_name(value)
    if normalized == normalize_team_name(match.get("home")):
        return match["home"]
    if normalized == normalize_team_name(match.get("away")):
        return match["away"]
    return None


def normalize_team_name(value: Any) -> str:
    return "".join(char for char in str(value or "").lower() if char.isalnum())


def normalize_stat_name(value: Any) -> str:
    return str(value or "").strip().lower()


def parse_percent(value: Any) -> int:
    if isinstance(value, str):
        value = value.replace("%", "").strip()
    return safe_int(value)


def lineup_grid_to_xy(value: str, side: str) -> dict[str, float] | None:
    if ":" not in value:
        return None
    row, col = value.split(":", 1)
    row_number = safe_int(row)
    col_number = safe_int(col)
    if row_number <= 0 or col_number <= 0:
        return None
    home_x = min(48, 8 + (row_number - 1) * 10)
    x = home_x if side == "home" else 100 - home_x
    return {"x": x, "y": min(90, 16 + (col_number - 1) * 14)}


def safe_int(value: Any) -> int:
    try:
        if value in (None, ""):
            return 0
        return int(float(str(value).replace("%", "")))
    except (TypeError, ValueError):
        return 0


def safe_int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return safe_int(value)


def safe_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None

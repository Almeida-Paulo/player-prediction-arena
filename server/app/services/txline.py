import asyncio
import json
import logging
from typing import Any

import httpx

from ..config import Settings
from ..db import get_pool
from .api_football import hydrate_api_football_details

logger = logging.getLogger(__name__)
_txline_odds_tables_ready = False


async def fetch_txline_matches(settings: Settings) -> list[dict[str, Any]] | None:
    if not settings.txline_api_token:
        return None

    base = settings.txline_api_base.rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            guest_jwt = settings.txline_guest_jwt or await start_guest_session(client, base)
            if not guest_jwt:
                return load_txline_match_snapshots() or None

            response = await fetch_fixtures_snapshot(client, base, settings, guest_jwt)

            if response.status_code == 401 and not settings.txline_guest_jwt:
                guest_jwt = await start_guest_session(client, base)
                if not guest_jwt:
                    return load_txline_match_snapshots() or None
                response = await fetch_fixtures_snapshot(client, base, settings, guest_jwt)

            if response.status_code >= 400:
                return load_txline_match_snapshots() or None

            try:
                payload = response.json()
            except ValueError:
                return load_txline_match_snapshots() or None

            if isinstance(payload, list):
                items = payload
            elif isinstance(payload, dict):
                items = payload.get("data", [])
            else:
                items = []

            mapped_pairs = [
                (item, mapped)
                for item in items
                if isinstance(item, dict) and (mapped := map_txline_fixture(item))
            ]
            world_cup_matches = [mapped for item, mapped in mapped_pairs if is_world_cup_fixture(item)]
            matches = world_cup_matches or [mapped for _, mapped in mapped_pairs]
            if matches:
                await hydrate_odds_snapshots(client, base, settings, guest_jwt, matches)
                try:
                    await hydrate_api_football_details(client, settings, matches)
                except Exception as exc:
                    logger.warning("Unable to hydrate API-FOOTBALL details: %s", exc)
                save_txline_match_snapshots(matches)
                matches = merge_cached_matches(matches)
            return matches or load_txline_match_snapshots() or None
    except (httpx.HTTPError, RuntimeError):
        return load_txline_match_snapshots() or None


async def start_guest_session(client: httpx.AsyncClient, base: str) -> str | None:
    try:
        response = await client.post(f"{base}/auth/guest/start", headers={"Accept": "application/json"})
        if response.status_code >= 400:
            return None
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    token = payload.get("token") if isinstance(payload, dict) else payload
    return token if isinstance(token, str) and token else None


async def fetch_fixtures_snapshot(
    client: httpx.AsyncClient,
    base: str,
    settings: Settings,
    guest_jwt: str,
) -> httpx.Response:
    params: dict[str, str] = {}
    if settings.txline_competition_id:
        params["competitionId"] = settings.txline_competition_id

    return await client.get(
        f"{base}/api/fixtures/snapshot",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {guest_jwt}",
            "X-Api-Token": settings.txline_api_token,
        },
        params=params,
    )


async def fetch_odds_snapshot(
    client: httpx.AsyncClient,
    base: str,
    settings: Settings,
    guest_jwt: str,
    fixture_id: str,
) -> list[dict[str, Any]]:
    try:
        response = await client.get(
            f"{base}/api/odds/snapshot/{fixture_id}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {guest_jwt}",
                "X-Api-Token": settings.txline_api_token,
            },
            timeout=5,
        )
        if response.status_code >= 400:
            return []
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        data = payload.get("data", [])
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
    return []


async def hydrate_odds_snapshots(
    client: httpx.AsyncClient,
    base: str,
    settings: Settings,
    guest_jwt: str,
    matches: list[dict[str, Any]],
) -> None:
    await asyncio.gather(
        *(
            hydrate_odds_snapshot(client, base, settings, guest_jwt, match)
            for match in matches[:8]
        )
    )


async def hydrate_odds_snapshot(
    client: httpx.AsyncClient,
    base: str,
    settings: Settings,
    guest_jwt: str,
    match: dict[str, Any],
) -> None:
    fixture_id = str(match.get("id") or "")
    if not fixture_id:
        return

    odds_items = await fetch_odds_snapshot(client, base, settings, guest_jwt, fixture_id)
    mapped_odds = [mapped for item in odds_items for mapped in map_txline_odds(item, match)]
    if mapped_odds:
        sorted_odds = sorted(mapped_odds, key=odds_sort_key)[:24]
        match["odds"] = sorted_odds
        save_txline_odds_snapshot(fixture_id, odds_items, sorted_odds)
        return

    cached_odds = load_txline_odds_snapshot(fixture_id)
    if cached_odds:
        match["odds"] = sorted(cached_odds, key=odds_sort_key)[:24]


def map_txline_fixture(item: dict[str, Any]) -> dict[str, Any] | None:
    fixture_id = str(first_value(item, "FixtureId", "fixtureId", "id") or "")
    participant_1 = str(first_value(item, "Participant1", "participant1", "homeTeam", "home") or "")
    participant_2 = str(first_value(item, "Participant2", "participant2", "awayTeam", "away") or "")
    if not fixture_id or not participant_1 or not participant_2:
        return None

    participant_1_is_home = parse_bool(first_value(item, "Participant1IsHome", "participant1IsHome"), True)
    home = participant_1 if participant_1_is_home else participant_2
    away = participant_2 if participant_1_is_home else participant_1
    home_score, away_score = score_from_item(item, home, away, participant_1_is_home)
    status = normalize_status(item)

    return {
        "id": fixture_id,
        "home": home,
        "away": away,
        "homeCode": team_code(home),
        "awayCode": team_code(away),
        "txlineParticipant1": participant_1,
        "txlineParticipant2": participant_2,
        "txlineParticipant1IsHome": participant_1_is_home,
        "homeLogoUrl": first_value(item, "HomeLogoUrl", "homeLogoUrl", "HomeBadge", "homeBadge"),
        "awayLogoUrl": first_value(item, "AwayLogoUrl", "awayLogoUrl", "AwayBadge", "awayBadge"),
        "competition": first_value(item, "Competition", "competition", "CompetitionName", "competitionName", "Country"),
        "round": first_value(item, "Fixture", "fixture", "Group", "group"),
        "startTime": first_value(item, "StartTime", "startTime", "start_time"),
        "minute": str(first_value(item, "Minute", "minute") or ("FT" if status == "FINAL" else "0'")),
        "status": status,
        "score": {home: home_score, away: away_score},
        "stats": {
            home: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
            away: {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0},
        },
        "ratings": {},
        "mom": home,
        "source": "txline",
        "oracleProof": f"txline:{fixture_id}",
        "events": map_events(item, home, away),
        "odds": [],
    }


def map_txline_odds(item: dict[str, Any], match: dict[str, Any]) -> list[dict[str, Any]]:
    market = str(
        first_value(
            item,
            "SuperOddsType",
            "superOddsType",
            "OddsType",
            "oddsType",
            "Market",
            "market",
            "MarketName",
            "marketName",
        )
        or ""
    )
    scalar_selection = str(
        first_value(
            item,
            "Selection",
            "selection",
            "Outcome",
            "outcome",
            "Name",
            "name",
            "Participant",
            "participant",
        )
        or ""
    )
    price_names = first_value(item, "PriceNames", "priceNames")
    prices = first_value(item, "Prices", "prices")
    pcts = first_value(item, "Pct", "pct", "Pcts", "pcts")
    if isinstance(price_names, list) or isinstance(prices, list) or isinstance(pcts, list):
        entry_count = max(
            list_length(price_names),
            list_length(prices),
            list_length(pcts),
            1,
        )
        entries: list[dict[str, Any]] = []
        for index in range(entry_count):
            selection_meta = normalize_txline_price_name(list_value(price_names, index) or scalar_selection, match)
            decimal = normalize_decimal_price(list_value(prices, index))
            implied = parse_probability(list_value(pcts, index))
            if not any([market, selection_meta["selection"], decimal, implied]):
                continue
            odds_id = str(
                first_value(item, "Id", "id", "OddsId", "oddsId", "MarketId", "marketId", "MessageId", "messageId")
                or f"{market}:{selection_meta['selection']}:{index}"
            )
            entries.append(
                {
                    "id": f"{odds_id}:{index}",
                    "market": market or "Market",
                    "selection": selection_meta["selection"],
                    "shortLabel": selection_meta["shortLabel"],
                    "selectionRole": selection_meta["selectionRole"],
                    "sortOrder": selection_meta["sortOrder"],
                    "decimal": decimal,
                    "impliedProbability": implied,
                    "status": first_value(item, "Status", "status", "Suspended", "suspended", "GameState", "gameState"),
                    "updatedAt": first_value(item, "Ts", "ts", "Timestamp", "timestamp", "UpdatedAt", "updatedAt"),
                    "source": "txline",
                }
            )
        return entries

    selection = scalar_selection
    selection_meta = normalize_txline_price_name(selection, match)
    decimal = safe_float(
        first_value(
            item,
            "Decimal",
            "decimal",
            "DecimalOdds",
            "decimalOdds",
            "Price",
            "price",
            "Odds",
            "odds",
        )
    )
    american = safe_int_or_none(first_value(item, "American", "american", "AmericanOdds", "americanOdds"))
    implied = safe_float(
        first_value(
            item,
            "ImpliedProbability",
            "impliedProbability",
            "Probability",
            "probability",
            "Prob",
            "prob",
        )
    )
    if implied and implied > 1:
        implied = implied / 100
    if not implied and decimal and decimal > 1:
        implied = 1 / decimal

    if not any([market, selection, decimal, american, implied]):
        return []

    odds_id = str(first_value(item, "Id", "id", "OddsId", "oddsId", "MarketId", "marketId") or f"{market}:{selection}")
    return [
        {
            "id": odds_id,
            "market": market or "Market",
            "selection": selection_meta["selection"] or "Selection",
            "shortLabel": selection_meta["shortLabel"],
            "selectionRole": selection_meta["selectionRole"],
            "sortOrder": selection_meta["sortOrder"],
            "decimal": decimal,
            "american": american,
            "impliedProbability": implied,
            "status": first_value(item, "Status", "status", "Suspended", "suspended"),
            "updatedAt": first_value(item, "Ts", "ts", "Timestamp", "timestamp", "UpdatedAt", "updatedAt"),
            "source": "txline",
        }
    ]


def normalize_txline_price_name(value: Any, match: dict[str, Any]) -> dict[str, Any]:
    raw = str(value or "").strip()
    key = raw.lower().replace(" ", "").replace("_", "").replace("-", "")
    participant1_is_home = bool(match.get("txlineParticipant1IsHome", True))
    home = str(match.get("home") or "Home")
    away = str(match.get("away") or "Away")

    if key in {"draw", "x", "tie"}:
        return {"selection": "Draw", "shortLabel": "X", "selectionRole": "draw", "sortOrder": 1}
    if key in {"part1", "participant1", "p1", "1"}:
        return (
            {"selection": home, "shortLabel": "1", "selectionRole": "home", "sortOrder": 0}
            if participant1_is_home
            else {"selection": away, "shortLabel": "2", "selectionRole": "away", "sortOrder": 2}
        )
    if key in {"part2", "participant2", "p2", "2"}:
        return (
            {"selection": away, "shortLabel": "2", "selectionRole": "away", "sortOrder": 2}
            if participant1_is_home
            else {"selection": home, "shortLabel": "1", "selectionRole": "home", "sortOrder": 0}
        )
    if key in {"home", "hometeam"} or raw == home:
        return {"selection": home, "shortLabel": "1", "selectionRole": "home", "sortOrder": 0}
    if key in {"away", "awayteam"} or raw == away:
        return {"selection": away, "shortLabel": "2", "selectionRole": "away", "sortOrder": 2}
    return {"selection": raw or "Selection", "shortLabel": "", "selectionRole": "other", "sortOrder": 3}


def odds_sort_key(item: dict[str, Any]) -> tuple[int, int, str]:
    market = str(item.get("market") or "").lower()
    is_result = "1x2" in market or "participant result" in market or "result" in market
    return (0 if is_result else 1, safe_int(item.get("sortOrder", 3)), str(item.get("selection") or ""))


def ensure_txline_odds_tables() -> bool:
    global _txline_odds_tables_ready
    if _txline_odds_tables_ready:
        return True

    try:
        with get_pool().connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS txline_odds_snapshots (
                  fixture_id TEXT PRIMARY KEY,
                  odds_json JSONB NOT NULL,
                  raw_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                  source_ts BIGINT,
                  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS txline_odds_history (
                  fixture_id TEXT NOT NULL,
                  odds_id TEXT NOT NULL,
                  market TEXT NOT NULL,
                  selection TEXT NOT NULL,
                  short_label TEXT,
                  selection_role TEXT,
                  decimal_price NUMERIC,
                  american_price INTEGER,
                  implied_probability NUMERIC,
                  source_ts BIGINT NOT NULL DEFAULT 0,
                  odds_json JSONB NOT NULL,
                  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  PRIMARY KEY (fixture_id, odds_id, source_ts)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_txline_odds_history_fixture_time
                  ON txline_odds_history(fixture_id, source_ts DESC)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS match_snapshots (
                  fixture_id TEXT PRIMARY KEY,
                  match_json JSONB NOT NULL,
                  source TEXT NOT NULL DEFAULT 'txline',
                  status TEXT,
                  start_time BIGINT,
                  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_match_snapshots_start_time
                  ON match_snapshots(start_time DESC)
                """
            )
        _txline_odds_tables_ready = True
        return True
    except Exception as exc:
        logger.warning("Unable to ensure TXLine odds tables: %s", exc)
        return False


def save_txline_odds_snapshot(
    fixture_id: str,
    raw_items: list[dict[str, Any]],
    mapped_odds: list[dict[str, Any]],
) -> None:
    if not mapped_odds or not ensure_txline_odds_tables():
        return

    source_ts_values = [
        safe_int_or_none(first_value(item, "Ts", "ts", "Timestamp", "timestamp"))
        for item in raw_items
    ]
    source_ts = max((value for value in source_ts_values if value is not None), default=None)

    try:
        with get_pool().connection() as conn:
            conn.execute(
                """
                INSERT INTO txline_odds_snapshots (fixture_id, odds_json, raw_json, source_ts, fetched_at, updated_at)
                VALUES (%s, %s::jsonb, %s::jsonb, %s, now(), now())
                ON CONFLICT (fixture_id) DO UPDATE SET
                  odds_json = EXCLUDED.odds_json,
                  raw_json = EXCLUDED.raw_json,
                  source_ts = EXCLUDED.source_ts,
                  fetched_at = EXCLUDED.fetched_at,
                  updated_at = now()
                """,
                (fixture_id, json.dumps(mapped_odds), json.dumps(raw_items), source_ts),
            )
            for odd in mapped_odds:
                odd_source_ts = safe_int_or_none(odd.get("updatedAt")) or 0
                conn.execute(
                    """
                    INSERT INTO txline_odds_history (
                      fixture_id, odds_id, market, selection, short_label, selection_role,
                      decimal_price, american_price, implied_probability, source_ts, odds_json, captured_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now())
                    ON CONFLICT (fixture_id, odds_id, source_ts) DO NOTHING
                    """,
                    (
                        fixture_id,
                        str(odd.get("id") or ""),
                        str(odd.get("market") or ""),
                        str(odd.get("selection") or ""),
                        odd.get("shortLabel"),
                        odd.get("selectionRole"),
                        odd.get("decimal"),
                        odd.get("american"),
                        odd.get("impliedProbability"),
                        odd_source_ts,
                        json.dumps(odd),
                    ),
                )
    except Exception as exc:
        logger.warning("Unable to save TXLine odds snapshot for fixture %s: %s", fixture_id, exc)


def load_txline_odds_snapshot(fixture_id: str) -> list[dict[str, Any]]:
    if not ensure_txline_odds_tables():
        return []

    try:
        with get_pool().connection() as conn:
            row = conn.execute(
                "SELECT odds_json FROM txline_odds_snapshots WHERE fixture_id = %s",
                (fixture_id,),
            ).fetchone()
    except Exception as exc:
        logger.warning("Unable to load cached TXLine odds for fixture %s: %s", fixture_id, exc)
        return []

    if not row:
        return []
    odds_json = row["odds_json"]
    if isinstance(odds_json, list):
        return [item for item in odds_json if isinstance(item, dict)]
    if isinstance(odds_json, str):
        try:
            loaded = json.loads(odds_json)
        except ValueError:
            return []
        return [item for item in loaded if isinstance(item, dict)] if isinstance(loaded, list) else []
    return []


def save_txline_match_snapshots(matches: list[dict[str, Any]]) -> None:
    if not matches or not ensure_txline_odds_tables():
        return
    try:
        with get_pool().connection() as conn:
            for match in matches:
                fixture_id = str(match.get("id") or "")
                if not fixture_id:
                    continue
                existing_row = conn.execute(
                    "SELECT match_json FROM match_snapshots WHERE fixture_id = %s",
                    (fixture_id,),
                ).fetchone()
                existing_match = coerce_match_json(existing_row["match_json"]) if existing_row else None
                saved_match = merge_match_snapshot(existing_match, match)
                conn.execute(
                    """
                    INSERT INTO match_snapshots (fixture_id, match_json, source, status, start_time, fetched_at, updated_at)
                    VALUES (%s, %s::jsonb, %s, %s, %s, now(), now())
                    ON CONFLICT (fixture_id) DO UPDATE SET
                      match_json = EXCLUDED.match_json,
                      source = EXCLUDED.source,
                      status = EXCLUDED.status,
                      start_time = EXCLUDED.start_time,
                      fetched_at = EXCLUDED.fetched_at,
                      updated_at = now()
                    """,
                    (
                        fixture_id,
                        json.dumps(saved_match),
                        str(saved_match.get("source") or "txline"),
                        str(saved_match.get("status") or ""),
                        safe_int_or_none(saved_match.get("startTime")),
                    ),
                )
    except Exception as exc:
        logger.warning("Unable to save TXLine match snapshots: %s", exc)


def load_txline_match_snapshots(limit: int = 12) -> list[dict[str, Any]]:
    if not ensure_txline_odds_tables():
        return []
    try:
        with get_pool().connection() as conn:
            rows = conn.execute(
                """
                SELECT match_json
                FROM match_snapshots
                ORDER BY COALESCE(start_time, 0) DESC, updated_at DESC
                LIMIT %s
                """,
                (limit,),
            ).fetchall()
    except Exception as exc:
        logger.warning("Unable to load cached TXLine match snapshots: %s", exc)
        return []

    output: list[dict[str, Any]] = []
    for row in rows:
        match = coerce_match_json(row["match_json"])
        if not match:
            continue
        if not match.get("odds"):
            cached_odds = load_txline_odds_snapshot(str(match.get("id") or ""))
            if cached_odds:
                match["odds"] = sorted(cached_odds, key=odds_sort_key)[:24]
        output.append(match)
    return output


def merge_cached_matches(matches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cached = load_txline_match_snapshots()
    if not cached:
        return matches
    merged = {str(match.get("id")): match for match in cached if match.get("id")}
    for match in matches:
        if match.get("id"):
            key = str(match["id"])
            merged[key] = merge_match_snapshot(merged.get(key), match)
    return sorted(merged.values(), key=lambda item: safe_int(item.get("startTime")), reverse=True)


def merge_match_snapshot(
    cached: dict[str, Any] | None,
    incoming: dict[str, Any],
) -> dict[str, Any]:
    if not cached:
        return dict(incoming)

    merged = {**cached, **incoming}
    for field in ["odds", "events", "lineups", "ratings", "transfers"]:
        if is_empty_detail(incoming.get(field)) and not is_empty_detail(cached.get(field)):
            merged[field] = cached[field]

    for field in ["homeLogoUrl", "awayLogoUrl", "venueName", "venueCity", "detailSource", "detailProviderFixtureId"]:
        if not incoming.get(field) and cached.get(field):
            merged[field] = cached[field]

    if status_rank(str(cached.get("status") or "")) > status_rank(str(incoming.get("status") or "")):
        merged["status"] = cached.get("status")
        merged["minute"] = cached.get("minute")
        if not score_has_goals(incoming, incoming.get("home"), incoming.get("away")) and score_has_goals(cached, cached.get("home"), cached.get("away")):
            merged["score"] = cached.get("score")

    if stats_are_default(incoming) and not stats_are_default(cached):
        merged["stats"] = cached.get("stats")

    return merged


def coerce_match_json(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except ValueError:
            return None
        return dict(loaded) if isinstance(loaded, dict) else None
    return None


def is_empty_detail(value: Any) -> bool:
    if value in (None, ""):
        return True
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def status_rank(value: str) -> int:
    normalized = value.upper()
    if normalized == "FINAL":
        return 3
    if normalized == "LIVE":
        return 2
    if normalized == "SCHEDULED":
        return 1
    return 0


def score_has_goals(match: dict[str, Any], home: Any, away: Any) -> bool:
    score = match.get("score")
    if not isinstance(score, dict):
        return False
    return safe_int(score.get(str(home or ""), 0)) + safe_int(score.get(str(away or ""), 0)) > 0


def stats_are_default(match: dict[str, Any]) -> bool:
    stats = match.get("stats")
    if not isinstance(stats, dict) or not stats:
        return True
    for values in stats.values():
        if not isinstance(values, dict):
            continue
        if safe_int(values.get("shotsAgainst")) or safe_int(values.get("cornersAgainst")):
            return False
        possession = safe_int(values.get("possession"))
        if possession not in {0, 50}:
            return False
    return True


def first_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return value
    return None


def parse_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return default


def normalize_status(item: dict[str, Any]) -> str:
    value = first_value(item, "status", "Status", "GameState", "gameState")
    raw = str(value or "").lower()
    if raw in {"2", "3", "4", "5"} or any(term in raw for term in ["live", "running", "inplay", "period"]):
        return "LIVE"
    if any(term in raw for term in ["final", "finished", "complete", "closed", "settled"]):
        return "FINAL"
    return "SCHEDULED"


def score_from_item(item: dict[str, Any], home: str, away: str, participant_1_is_home: bool) -> tuple[int, int]:
    score = first_value(item, "score", "Score")
    if isinstance(score, dict):
        return safe_int(score.get(home, 0)), safe_int(score.get(away, 0))

    home_score = first_value(item, "HomeScore", "homeScore", "home_score")
    away_score = first_value(item, "AwayScore", "awayScore", "away_score")
    if home_score is not None and away_score is not None:
        return safe_int(home_score), safe_int(away_score)

    participant_1_score = first_value(item, "Participant1Score", "participant1Score", "Score1", "score1")
    participant_2_score = first_value(item, "Participant2Score", "participant2Score", "Score2", "score2")
    if participant_1_score is not None and participant_2_score is not None:
        p1 = safe_int(participant_1_score)
        p2 = safe_int(participant_2_score)
        return (p1, p2) if participant_1_is_home else (p2, p1)

    return 0, 0


def map_events(item: dict[str, Any], home: str, away: str) -> list[dict[str, Any]]:
    raw_events = first_value(item, "Events", "events", "ScoreEvents", "scoreEvents")
    if not isinstance(raw_events, list):
        return []

    events: list[dict[str, Any]] = []
    for event in raw_events:
        if not isinstance(event, dict):
            continue
        event_type = str(first_value(event, "type", "Type", "eventType", "EventType") or "").lower()
        if "goal" not in event_type:
            continue
        team = str(first_value(event, "team", "Team", "participant", "Participant") or home)
        if team not in {home, away}:
            team = home
        player = str(first_value(event, "player", "Player", "playerName", "PlayerName") or "Unknown player")
        minute = safe_int(first_value(event, "minute", "Minute"))
        tags = first_value(event, "tags", "Tags") or []
        if isinstance(tags, str):
            tags = [tags]
        if not isinstance(tags, list):
            tags = []
        events.append({"type": "goal", "team": team, "player": player, "minute": minute, "tags": tags})
    return events


def safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def safe_int_or_none(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def safe_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def list_length(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def list_value(value: Any, index: int) -> Any:
    if not isinstance(value, list) or index >= len(value):
        return None
    return value[index]


def parse_probability(value: Any) -> float | None:
    if isinstance(value, str) and value.strip().upper() == "NA":
        return None
    parsed = safe_float(value)
    if parsed is None:
        return None
    return parsed / 100 if parsed > 1 else parsed


def normalize_decimal_price(value: Any) -> float | None:
    parsed = safe_float(value)
    if parsed is None or parsed <= 0:
        return None
    if parsed >= 1000:
        return parsed / 1000
    if parsed >= 100:
        return parsed / 100
    return parsed


def is_world_cup_fixture(item: dict[str, Any]) -> bool:
    text = " ".join(
        str(first_value(item, key) or "")
        for key in ["Competition", "competition", "CompetitionName", "competitionName", "Fixture", "fixture", "Group", "group"]
    ).lower()
    return "world cup" in text


def team_code(name: str) -> str:
    clean = "".join(char for char in name.upper() if char.isalnum() or char.isspace()).strip()
    parts = clean.split()
    if len(parts) > 1:
        return "".join(part[0] for part in parts[:3])[:3]
    return clean[:3]

from typing import Any

import httpx

from ..config import Settings


async def fetch_txline_matches(settings: Settings) -> list[dict[str, Any]] | None:
    if not settings.txline_api_token:
        return None

    base = settings.txline_api_base.rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            guest_jwt = settings.txline_guest_jwt or await start_guest_session(client, base)
            if not guest_jwt:
                return None

            response = await fetch_fixtures_snapshot(client, base, settings, guest_jwt)

            if response.status_code == 401 and not settings.txline_guest_jwt:
                guest_jwt = await start_guest_session(client, base)
                if not guest_jwt:
                    return None
                response = await fetch_fixtures_snapshot(client, base, settings, guest_jwt)

            if response.status_code >= 400:
                return None

            try:
                payload = response.json()
            except ValueError:
                return None

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
            return matches or None
    except (httpx.HTTPError, RuntimeError):
        return None


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
    for match in matches[:8]:
        fixture_id = str(match.get("id") or "")
        if not fixture_id:
            continue
        odds_items = await fetch_odds_snapshot(client, base, settings, guest_jwt, fixture_id)
        mapped_odds = [mapped for item in odds_items for mapped in map_txline_odds(item)]
        match["odds"] = mapped_odds[:24]


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


def map_txline_odds(item: dict[str, Any]) -> list[dict[str, Any]]:
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
            selection = str(list_value(price_names, index) or scalar_selection or f"Selection {index + 1}")
            decimal = normalize_decimal_price(list_value(prices, index))
            implied = parse_probability(list_value(pcts, index))
            if not any([market, selection, decimal, implied]):
                continue
            odds_id = str(
                first_value(item, "Id", "id", "OddsId", "oddsId", "MarketId", "marketId", "MessageId", "messageId")
                or f"{market}:{selection}:{index}"
            )
            entries.append(
                {
                    "id": f"{odds_id}:{index}",
                    "market": market or "Market",
                    "selection": selection,
                    "decimal": decimal,
                    "impliedProbability": implied,
                    "status": first_value(item, "Status", "status", "Suspended", "suspended", "GameState", "gameState"),
                    "updatedAt": first_value(item, "Ts", "ts", "Timestamp", "timestamp", "UpdatedAt", "updatedAt"),
                    "source": "txline",
                }
            )
        return entries

    selection = scalar_selection
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
            "selection": selection or "Selection",
            "decimal": decimal,
            "american": american,
            "impliedProbability": implied,
            "status": first_value(item, "Status", "status", "Suspended", "suspended"),
            "updatedAt": first_value(item, "Ts", "ts", "Timestamp", "timestamp", "UpdatedAt", "updatedAt"),
            "source": "txline",
        }
    ]


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

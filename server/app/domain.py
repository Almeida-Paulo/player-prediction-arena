from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Card:
    id: str
    type: str
    name: str
    rarity: str
    bonus_bps: int
    condition: str
    settlement_key: str
    data_needs: list[str]


CARDS: list[Card] = [
    Card("gol", "moment", "Goal", "basic", 40, "Selected player or team scores.", "goal", ["txline.score_events"]),
    Card("clean-sheet", "moment", "Clean Sheet", "basic", 100, "Selected team finishes without conceding.", "clean_sheet", ["txline.final_score"]),
    Card("hat-trick", "moment", "Hat-Trick", "rare", 500, "Same player scores 3 goals.", "hat_trick", ["txline.score_events.player_id"]),
    Card("ultimo-lance", "moment", "Last Touch", "rare", 600, "Final decisive goal changes the result state.", "last_touch", ["txline.score_events.minute"]),
    Card("rolo-compressor", "moment", "Steamroller", "rare", 600, "Selected team wins by 4+ goals.", "steamroller", ["txline.final_score"]),
    Card("bicicleta", "moment", "Bicycle Kick", "legendary", 1200, "Goal is tagged as a bicycle kick.", "bicycle_goal", ["secondary.event_tag_or_manual_review"]),
    Card("olimpico", "moment", "Olympic Goal", "legendary", 1400, "Direct goal from a corner kick.", "olympic_goal", ["secondary.event_tag_or_manual_review"]),
    Card("poker-trick", "moment", "Poker-Trick", "legendary", 1600, "Same player scores 4 goals.", "poker_trick", ["txline.score_events.player_id"]),
    Card("penta-trick", "moment", "Penta-Trick", "legendary", 2000, "Same player scores 5 goals.", "penta_trick", ["txline.score_events.player_id"]),
    Card("mom", "power", "MOM", "legendary", 1000, "Selected player is the top-rated player of the match.", "mom", ["local_rating_or_secondary_ratings"]),
    Card("tiki-taka", "historic", "Tiki-Taka", "rare", 300, "Selected team finishes with more than 60% possession.", "tiki_taka", ["secondary.team_stats.possession"]),
    Card("catenaccio", "historic", "Catenaccio", "rare", 400, "Clean sheet under pressure: possession below 45%, 12+ shots faced, or 6+ corners faced.", "catenaccio", ["txline.final_score", "secondary.team_stats"]),
    Card("carrousel", "historic", "Carrousel", "legendary", 1000, "4+ different players score for the selected team.", "carrousel", ["txline.score_events.player_id"]),
    Card("jogo-bonito", "historic", "Jogo Bonito", "rare", 600, "Team scores 3+ and wins by a 3+ goal margin.", "jogo_bonito", ["txline.final_score"]),
]

BADGES: list[dict[str, str]] = [
    {"id": "starter-scout", "name": "Starter Scout", "condition": "Open the first Starter Pack.", "category": "onboarding"},
    {"id": "pack-runner", "name": "Pack Runner", "condition": "Place 10 predictions and unlock the starter pack.", "category": "onboarding"},
    {"id": "sharp-scout", "name": "Sharp Scout", "condition": "Win 3 predictions in a row.", "category": "prediction"},
    {"id": "live-trader", "name": "Live Trader", "condition": "Create 3 predictions on the same match.", "category": "prediction"},
    {"id": "risk-manager", "name": "Risk Manager", "condition": "Win a prediction with stake up to 10% of pre-trade balance.", "category": "risk"},
    {"id": "oracle-believer", "name": "Oracle Believer", "condition": "Settle a prediction with a TXLine proof.", "category": "oracle"},
    {"id": "legend-caller", "name": "Legend Caller", "condition": "Activate a legendary card on a winning prediction.", "category": "prediction"},
]

MARKETS: list[dict[str, Any]] = [
    {"id": "home-win", "label": "Home team wins", "kind": "result", "oddsBps": 17400, "settlementKey": "home_win"},
    {"id": "away-win", "label": "Away team wins", "kind": "result", "oddsBps": 21800, "settlementKey": "away_win"},
    {"id": "home-goal", "label": "Home team scores", "kind": "goal", "oddsBps": 12800, "settlementKey": "home_scores"},
    {"id": "home-clean-sheet", "label": "Home team clean sheet", "kind": "defense", "oddsBps": 26500, "settlementKey": "home_clean_sheet"},
    {"id": "hat-trick-market", "label": "Any hat-trick", "kind": "player", "oddsBps": 56000, "settlementKey": "any_hat_trick"},
    {"id": "mom-home-team", "label": "MOM from home team", "kind": "rating", "oddsBps": 34000, "settlementKey": "mom_home_team"},
]


def goal(team: str, player: str, minute: int, tags: list[str] | None = None) -> dict[str, Any]:
    return {"type": "goal", "team": team, "player": player, "minute": minute, "tags": tags or []}


DEMO_MATCHES: list[dict[str, Any]] = [
    {
        "id": "bra-arg",
        "home": "Brasil",
        "away": "Argentina",
        "homeCode": "BRA",
        "awayCode": "ARG",
        "minute": "78'",
        "status": "LIVE",
        "score": {"Brasil": 4, "Argentina": 1},
        "stats": {
            "Brasil": {"possession": 64, "shotsAgainst": 8, "cornersAgainst": 3},
            "Argentina": {"possession": 36, "shotsAgainst": 16, "cornersAgainst": 8},
        },
        "ratings": {"Valente": 8.9, "Aurora": 8.1, "Nilo": 7.7, "Reis": 7.5, "Ortega": 7.1},
        "mom": "Valente",
        "source": "demo",
        "oracleProof": "demo-txline-merkle-proof:bra-arg",
        "events": [
            goal("Brasil", "Aurora", 12),
            goal("Argentina", "Ortega", 30),
            goal("Brasil", "Valente", 44, ["bicycle"]),
            goal("Brasil", "Nilo", 76),
            goal("Brasil", "Reis", 90, ["stoppage"]),
        ],
    },
    {
        "id": "nld-jpn",
        "home": "Holanda",
        "away": "Japao",
        "homeCode": "NLD",
        "awayCode": "JPN",
        "minute": "FT",
        "status": "FINAL",
        "score": {"Holanda": 1, "Japao": 0},
        "stats": {
            "Holanda": {"possession": 42, "shotsAgainst": 15, "cornersAgainst": 7},
            "Japao": {"possession": 58, "shotsAgainst": 6, "cornersAgainst": 2},
        },
        "ratings": {"Vermeer": 8.7, "Kaito": 7.4, "Daan": 7.1},
        "mom": "Vermeer",
        "source": "demo",
        "oracleProof": "demo-txline-merkle-proof:nld-jpn",
        "events": [goal("Holanda", "Daan", 71)],
    },
    {
        "id": "mex-usa",
        "home": "Mexico",
        "away": "Estados Unidos",
        "homeCode": "MEX",
        "awayCode": "USA",
        "minute": "FT",
        "status": "FINAL",
        "score": {"Mexico": 5, "Estados Unidos": 0},
        "stats": {
            "Mexico": {"possession": 57, "shotsAgainst": 4, "cornersAgainst": 1},
            "Estados Unidos": {"possession": 43, "shotsAgainst": 21, "cornersAgainst": 9},
        },
        "ratings": {"Solano": 9.7, "Rivas": 8.2, "Brooks": 5.9},
        "mom": "Solano",
        "source": "demo",
        "oracleProof": "demo-txline-merkle-proof:mex-usa",
        "events": [
            goal("Mexico", "Solano", 9),
            goal("Mexico", "Solano", 27),
            goal("Mexico", "Rivas", 33, ["olympic"]),
            goal("Mexico", "Solano", 58),
            goal("Mexico", "Solano", 82),
        ],
    },
]


def public_cards() -> list[dict[str, Any]]:
    return [
        {
            "id": card.id,
            "type": card.type,
            "name": card.name,
            "rarity": card.rarity,
            "bonusBps": card.bonus_bps,
            "condition": card.condition,
            "settlementKey": card.settlement_key,
            "dataNeeds": card.data_needs,
        }
        for card in CARDS
    ]


def starter_pack_pool() -> list[Card]:
    return [card for card in CARDS if card.rarity == "basic"]


def settle_position(match: dict[str, Any], position: dict[str, Any]) -> dict[str, Any]:
    market = next((item for item in MARKETS if item["id"] == position["marketId"]), None)
    if not market:
        raise ValueError(f"unknown market: {position['marketId']}")

    won = resolve_market(market, match)
    if not won:
        return {
            **position,
            "settled": True,
            "won": False,
            "grossPayoutCents": 0,
            "netProfitCents": 0,
            "bonusCents": 0,
            "payoutCents": 0,
            "activatedCardIds": [],
            "oracleProof": match.get("oracleProof") or f"txline:{match['id']}:pending-proof",
        }

    gross = (position["stakeCents"] * position["oddsBps"]) // 10000
    profit = max(0, gross - position["stakeCents"])
    active_cards = [
        card
        for card_id in position.get("cardIds", [])
        for card in CARDS
        if card.id == card_id and resolve_card(card, match, position["context"])
    ]
    bonus_bps = sum(card.bonus_bps for card in active_cards)
    bonus = (profit * bonus_bps) // 10000

    return {
        **position,
        "settled": True,
        "won": True,
        "grossPayoutCents": gross,
        "netProfitCents": profit,
        "bonusCents": bonus,
        "payoutCents": gross + bonus,
        "activatedCardIds": [card.id for card in active_cards],
        "oracleProof": match.get("oracleProof") or f"txline:{match['id']}:pending-proof",
    }


def resolve_market(market: dict[str, Any], match: dict[str, Any]) -> bool:
    key = market["settlementKey"]
    if key == "home_win":
        return team_goals(match, match["home"]) > team_goals(match, match["away"])
    if key == "away_win":
        return team_goals(match, match["away"]) > team_goals(match, match["home"])
    if key == "home_scores":
        return team_goals(match, match["home"]) > 0
    if key == "home_clean_sheet":
        return goals_against(match, match["home"]) == 0
    if key == "any_hat_trick":
        return max_goals_by_player(match) >= 3
    if key == "mom_home_team":
        return scorer_team(match, match["mom"]) == match["home"]
    return False


def resolve_card(card: Card, match: dict[str, Any], context: dict[str, str]) -> bool:
    team = context["team"]
    if card.settlement_key == "goal":
        return team_goals(match, team) > 0
    if card.settlement_key == "clean_sheet":
        return goals_against(match, team) == 0
    if card.settlement_key == "hat_trick":
        return max_goals_by_player(match, team) >= 3
    if card.settlement_key == "last_touch":
        return last_goal_changed_result(match, team)
    if card.settlement_key == "steamroller":
        return goal_difference(match, team) >= 4
    if card.settlement_key == "bicycle_goal":
        return has_tagged_goal(match, team, "bicycle")
    if card.settlement_key == "olympic_goal":
        return has_tagged_goal(match, team, "olympic")
    if card.settlement_key == "poker_trick":
        return max_goals_by_player(match, team) >= 4
    if card.settlement_key == "penta_trick":
        return max_goals_by_player(match, team) >= 5
    if card.settlement_key == "mom":
        return match["mom"] == context["player"]
    if card.settlement_key == "tiki_taka":
        return team_stats(match, team)["possession"] > 60
    if card.settlement_key == "catenaccio":
        stats = team_stats(match, team)
        return goals_against(match, team) == 0 and (
            stats["possession"] < 45 or stats["shotsAgainst"] >= 12 or stats["cornersAgainst"] >= 6
        )
    if card.settlement_key == "carrousel":
        return unique_scorers(match, team) >= 4
    if card.settlement_key == "jogo_bonito":
        return team_goals(match, team) >= 3 and goal_difference(match, team) >= 3
    return False


def team_goals(match: dict[str, Any], team: str) -> int:
    return int(match["score"].get(team, 0))


def goals_against(match: dict[str, Any], team: str) -> int:
    opponent = match["away"] if team == match["home"] else match["home"]
    return team_goals(match, opponent)


def goal_difference(match: dict[str, Any], team: str) -> int:
    return team_goals(match, team) - goals_against(match, team)


def team_stats(match: dict[str, Any], team: str) -> dict[str, int]:
    return match.get("stats", {}).get(team, {"possession": 50, "shotsAgainst": 0, "cornersAgainst": 0})


def max_goals_by_player(match: dict[str, Any], team: str | None = None) -> int:
    counts: dict[str, int] = {}
    for event in match.get("events", []):
        if event["type"] == "goal" and (team is None or event["team"] == team):
            counts[event["player"]] = counts.get(event["player"], 0) + 1
    return max(counts.values(), default=0)


def unique_scorers(match: dict[str, Any], team: str) -> int:
    return len({event["player"] for event in match.get("events", []) if event["type"] == "goal" and event["team"] == team})


def has_tagged_goal(match: dict[str, Any], team: str, tag: str) -> bool:
    return any(
        event["type"] == "goal" and event["team"] == team and tag in event.get("tags", [])
        for event in match.get("events", [])
    )


def last_goal_changed_result(match: dict[str, Any], team: str) -> bool:
    goals = [event for event in match.get("events", []) if event["type"] == "goal"]
    return bool(goals and goals[-1]["team"] == team and "decisive" in goals[-1].get("tags", []))


def scorer_team(match: dict[str, Any], player: str) -> str | None:
    for event in match.get("events", []):
        if event["type"] == "goal" and event["player"] == player:
            return event["team"]
    return None

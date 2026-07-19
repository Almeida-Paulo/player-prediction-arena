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
    {"id": "home-win", "label": "Home team wins", "kind": "result", "oddsBps": 17400, "settlementKey": "home_win", "scope": "all", "contextTeam": "home", "dataSource": "txline"},
    {"id": "away-win", "label": "Away team wins", "kind": "result", "oddsBps": 21800, "settlementKey": "away_win", "scope": "all", "contextTeam": "away", "dataSource": "txline"},
    {"id": "draw-after-90", "label": "Draw after regulation", "kind": "result", "oddsBps": 34000, "settlementKey": "draw_after_90", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will the match be tied after regulation?"},
    {"id": "home-goal", "label": "Home team scores", "kind": "goal", "oddsBps": 12800, "settlementKey": "home_scores", "scope": "all", "contextTeam": "home", "dataSource": "txline"},
    {"id": "away-goal", "label": "Away team scores", "kind": "goal", "oddsBps": 13200, "settlementKey": "away_scores", "scope": "all", "contextTeam": "away", "dataSource": "txline"},
    {"id": "both-teams-score", "label": "Both teams score", "kind": "goal", "oddsBps": 18800, "settlementKey": "both_teams_score", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will both teams score?"},
    {"id": "over-2-5-goals", "label": "Over 2.5 goals", "kind": "goal", "oddsBps": 20500, "settlementKey": "over_2_5_goals", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will the match have 3 or more goals?"},
    {"id": "over-3-5-goals", "label": "Over 3.5 goals", "kind": "goal", "oddsBps": 33500, "settlementKey": "over_3_5_goals", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will the match have 4 or more goals?"},
    {"id": "under-2-5-goals", "label": "Under 2.5 goals", "kind": "goal", "oddsBps": 18500, "settlementKey": "under_2_5_goals", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will the match finish with under 3 goals?"},
    {"id": "home-2plus-goals", "label": "Home team scores 2+", "kind": "goal", "oddsBps": 24500, "settlementKey": "home_2plus_goals", "scope": "all", "contextTeam": "home", "dataSource": "txline"},
    {"id": "away-2plus-goals", "label": "Away team scores 2+", "kind": "goal", "oddsBps": 28000, "settlementKey": "away_2plus_goals", "scope": "all", "contextTeam": "away", "dataSource": "txline"},
    {"id": "home-first-goal", "label": "Home team scores first", "kind": "goal", "oddsBps": 21000, "settlementKey": "home_first_goal", "scope": "all", "contextTeam": "home", "dataSource": "txline"},
    {"id": "home-clean-sheet", "label": "Home team clean sheet", "kind": "defense", "oddsBps": 26500, "settlementKey": "home_clean_sheet", "scope": "all", "contextTeam": "home", "dataSource": "txline"},
    {"id": "away-clean-sheet", "label": "Away team clean sheet", "kind": "defense", "oddsBps": 31000, "settlementKey": "away_clean_sheet", "scope": "all", "contextTeam": "away", "dataSource": "txline"},
    {"id": "hat-trick-market", "label": "Any hat-trick", "kind": "player", "oddsBps": 56000, "settlementKey": "any_hat_trick", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will any player score a hat-trick?"},
    {"id": "poker-trick-market", "label": "Any poker-trick", "kind": "player", "oddsBps": 125000, "settlementKey": "any_poker_trick", "scope": "all", "contextTeam": "none", "dataSource": "txline", "question": "Will any player score 4 goals?"},
    {"id": "penalty-shootout", "label": "Penalty shootout", "kind": "result", "oddsBps": 43000, "settlementKey": "penalty_shootout", "scope": "all", "contextTeam": "none", "dataSource": "api-football", "question": "Will the match go to penalties?", "marketNote": "Needs a secondary match-detail provider unless TXLine exposes shootout state."},
    {"id": "extra-time", "label": "Extra time", "kind": "result", "oddsBps": 36000, "settlementKey": "extra_time", "scope": "all", "contextTeam": "none", "dataSource": "api-football", "question": "Will the match go to extra time?", "marketNote": "Needs a secondary match-detail provider unless TXLine exposes extra-time state."},
    {"id": "home-possession-60", "label": "Home team 60% possession", "kind": "stats", "oddsBps": 42000, "settlementKey": "home_possession_60", "scope": "all", "contextTeam": "home", "dataSource": "api-football"},
    {"id": "away-possession-60", "label": "Away team 60% possession", "kind": "stats", "oddsBps": 48000, "settlementKey": "away_possession_60", "scope": "all", "contextTeam": "away", "dataSource": "api-football"},
    {"id": "home-most-corners", "label": "Home team more corners", "kind": "stats", "oddsBps": 21500, "settlementKey": "home_most_corners", "scope": "all", "contextTeam": "home", "dataSource": "api-football"},
    {"id": "away-most-corners", "label": "Away team more corners", "kind": "stats", "oddsBps": 23500, "settlementKey": "away_most_corners", "scope": "all", "contextTeam": "away", "dataSource": "api-football"},
    {"id": "mom-home-team", "label": "MOM from home team", "kind": "rating", "oddsBps": 34000, "settlementKey": "mom_home_team", "scope": "all", "contextTeam": "home", "dataSource": "api-football"},
    {"id": "mom-away-team", "label": "MOM from away team", "kind": "rating", "oddsBps": 36000, "settlementKey": "mom_away_team", "scope": "all", "contextTeam": "away", "dataSource": "api-football"},
    {"id": "world-cup-top-scorer", "label": "Golden Boot winner", "kind": "future", "oddsBps": 76000, "settlementKey": "manual", "scope": "world-cup", "contextTeam": "none", "dataSource": "manual", "question": "Will the World Cup top scorer come from Spain or Argentina?", "marketNote": "Future market for demo liquidity; admin settlement is required until a top-scorer feed is connected."},
    {"id": "world-cup-golden-ball", "label": "Golden Ball winner", "kind": "future", "oddsBps": 88000, "settlementKey": "manual", "scope": "world-cup", "contextTeam": "none", "dataSource": "manual", "question": "Will the Golden Ball winner play in the final?", "marketNote": "Future market for demo liquidity; admin settlement is required until awards data is connected."},
    {"id": "world-cup-most-team-goals", "label": "Most team goals", "kind": "future", "oddsBps": 52000, "settlementKey": "manual", "scope": "world-cup", "contextTeam": "none", "dataSource": "manual", "question": "Will Spain finish as the tournament top-scoring team?", "marketNote": "Future market for demo liquidity; admin settlement is required until standings/team totals are connected."},
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
        market = {"id": position["marketId"], "settlementKey": "manual", "dataSource": "manual"}
    if not can_settle_market(market, match):
        raise ValueError(f"market_not_settleable:{market['id']}")

    resolved_yes = resolve_market(market, match)
    won = not resolved_yes if position.get("outcome") == "no" else resolved_yes
    if not won:
        return {
            **position,
            "outcome": position.get("outcome", "yes"),
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
        "outcome": position.get("outcome", "yes"),
        "settled": True,
        "won": True,
        "grossPayoutCents": gross,
        "netProfitCents": profit,
        "bonusCents": bonus,
        "payoutCents": gross + bonus,
        "activatedCardIds": [card.id for card in active_cards],
        "oracleProof": match.get("oracleProof") or f"txline:{match['id']}:pending-proof",
    }


def can_settle_market(market: dict[str, Any], match: dict[str, Any]) -> bool:
    if market.get("settlementKey") == "manual":
        return False
    if match.get("status") != "FINAL":
        return False
    if market.get("dataSource") == "api-football" and not match.get("detailSource"):
        return False
    if market.get("settlementKey") in {"home_first_goal", "away_first_goal", "any_hat_trick", "any_poker_trick"}:
        return bool(match.get("events"))
    return True


def resolve_market(market: dict[str, Any], match: dict[str, Any]) -> bool:
    key = market["settlementKey"]
    if key == "home_win":
        return team_goals(match, match["home"]) > team_goals(match, match["away"])
    if key == "away_win":
        return team_goals(match, match["away"]) > team_goals(match, match["home"])
    if key == "draw_after_90":
        return team_goals(match, match["home"]) == team_goals(match, match["away"])
    if key == "home_scores":
        return team_goals(match, match["home"]) > 0
    if key == "away_scores":
        return team_goals(match, match["away"]) > 0
    if key == "both_teams_score":
        return team_goals(match, match["home"]) > 0 and team_goals(match, match["away"]) > 0
    if key == "over_2_5_goals":
        return total_goals(match) >= 3
    if key == "over_3_5_goals":
        return total_goals(match) >= 4
    if key == "under_2_5_goals":
        return total_goals(match) <= 2
    if key == "home_2plus_goals":
        return team_goals(match, match["home"]) >= 2
    if key == "away_2plus_goals":
        return team_goals(match, match["away"]) >= 2
    if key == "home_first_goal":
        return first_goal_team(match) == match["home"]
    if key == "away_first_goal":
        return first_goal_team(match) == match["away"]
    if key == "home_clean_sheet":
        return goals_against(match, match["home"]) == 0
    if key == "away_clean_sheet":
        return goals_against(match, match["away"]) == 0
    if key == "any_hat_trick":
        return max_goals_by_player(match) >= 3
    if key == "any_poker_trick":
        return max_goals_by_player(match) >= 4
    if key == "penalty_shootout":
        return any("penalty-shootout" in event.get("tags", []) for event in match.get("events", []))
    if key == "extra_time":
        return any(event.get("minute", 0) > 90 or "extra-time" in event.get("tags", []) for event in match.get("events", []))
    if key == "home_possession_60":
        return team_stats(match, match["home"])["possession"] > 60
    if key == "away_possession_60":
        return team_stats(match, match["away"])["possession"] > 60
    if key == "home_most_corners":
        return team_stats(match, match["home"])["cornersAgainst"] < team_stats(match, match["away"])["cornersAgainst"]
    if key == "away_most_corners":
        return team_stats(match, match["away"])["cornersAgainst"] < team_stats(match, match["home"])["cornersAgainst"]
    if key == "mom_home_team":
        return scorer_team(match, match["mom"]) == match["home"]
    if key == "mom_away_team":
        return scorer_team(match, match["mom"]) == match["away"]
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


def total_goals(match: dict[str, Any]) -> int:
    return team_goals(match, match["home"]) + team_goals(match, match["away"])


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


def first_goal_team(match: dict[str, Any]) -> str | None:
    goals = sorted((event for event in match.get("events", []) if event.get("type") == "goal"), key=lambda event: event.get("minute", 0))
    return goals[0].get("team") if goals else None


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

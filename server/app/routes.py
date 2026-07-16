from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings
from .db import get_pool
from .domain import BADGES, DEMO_MATCHES, MARKETS, public_cards, settle_position, starter_pack_pool
from .services.openligadb import fetch_openligadb_matches
from .services.txline import fetch_txline_matches

router = APIRouter()


class PositionContext(BaseModel):
    team: str
    player: str


class PositionPayload(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    matchId: str
    marketId: str
    marketLabel: str
    stakeCents: int = Field(gt=0)
    oddsBps: int = Field(gt=0)
    context: PositionContext
    cardIds: list[str] = Field(default_factory=list, max_length=3)


@router.get("/health")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {"ok": True, "app": "player-prediction-arena", "env": settings.app_env}


@router.get("/catalog")
async def catalog() -> dict[str, Any]:
    return {
        "cards": public_cards(),
        "badges": BADGES,
        "markets": MARKETS,
        "dataSources": [
            {"id": "txline", "label": "TXLine", "role": "oracle obrigatorio"},
            {"id": "openligadb", "label": "OpenLigaDB", "role": "fallback gratuito"},
            {"id": "statsbomb", "label": "StatsBomb Open Data", "role": "historico aberto"},
            {"id": "local-rating", "label": "Local Rating Engine", "role": "MOM sem API paga"},
        ],
    }


@router.get("/matches")
async def matches() -> list[dict[str, Any]]:
    settings = get_settings()
    txline = await fetch_txline_matches(settings)
    if txline:
        return txline
    openliga = await fetch_openligadb_matches(settings)
    if openliga:
        return openliga
    return DEMO_MATCHES


@router.post("/settle")
async def settle(payload: PositionPayload) -> dict[str, Any]:
    all_matches = await matches()
    match = next((item for item in all_matches if item["id"] == payload.matchId), None)
    if not match:
        match = next((item for item in DEMO_MATCHES if item["id"] == payload.matchId), None)
    if not match:
        raise HTTPException(status_code=404, detail="match_not_found")
    return settle_position(match, payload.model_dump())


@router.get("/users/{user_id}/state")
async def user_state(user_id: str) -> dict[str, Any]:
    with get_pool().connection() as conn:
        ensure_user(conn, user_id)
        user = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
        cards = conn.execute(
            "SELECT instance_id::text, card_id, locked_match_id, acquired_at FROM user_cards WHERE user_id = %s ORDER BY acquired_at DESC",
            (user_id,),
        ).fetchall()
        positions = conn.execute(
            "SELECT id::text, match_id, market_id, market_label, stake_cents, odds_bps, context_json, card_ids_json, created_at FROM positions WHERE user_id = %s AND settled = false ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return {"user": user, "cards": cards, "positions": positions}


@router.post("/users/{user_id}/positions")
async def create_position(user_id: str, payload: PositionPayload) -> dict[str, Any]:
    with get_pool().connection() as conn:
        ensure_user(conn, user_id)
        user = conn.execute("SELECT balance_cents FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user or user["balance_cents"] < payload.stakeCents:
            raise HTTPException(status_code=409, detail="insufficient_balance")

        validate_card_locks(conn, user_id, payload.matchId, payload.cardIds)

        conn.execute(
            """
            INSERT INTO positions (
              id, user_id, match_id, market_id, market_label, stake_cents, odds_bps, context_json, card_ids_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """,
            (
                UUID(payload.id),
                user_id,
                payload.matchId,
                payload.marketId,
                payload.marketLabel,
                payload.stakeCents,
                payload.oddsBps,
                json.dumps(payload.context.model_dump()),
                json.dumps(payload.cardIds),
            ),
        )
        if payload.cardIds:
            conn.execute(
                """
                UPDATE user_cards
                SET locked_match_id = %s
                WHERE user_id = %s AND card_id = ANY(%s) AND locked_match_id IS NULL
                """,
                (payload.matchId, user_id, payload.cardIds),
            )
        conn.execute(
            """
            UPDATE users
            SET balance_cents = balance_cents - %s,
                total_bets = total_bets + 1,
                updated_at = now()
            WHERE id = %s
            """,
            (payload.stakeCents, user_id),
        )
        return {"ok": True, "position": payload.model_dump()}


@router.post("/users/{user_id}/open-pack")
async def open_pack(user_id: str) -> dict[str, Any]:
    with get_pool().connection() as conn:
        ensure_user(conn, user_id)
        user = conn.execute("SELECT total_bets, packs_opened FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        if not user or user["total_bets"] < 10 or user["packs_opened"] > 0:
            raise HTTPException(status_code=409, detail="pack_not_available")

        pool = starter_pack_pool()
        awarded = [pool[index % len(pool)] for index in range(3)]
        for card in awarded:
            conn.execute("INSERT INTO user_cards (user_id, card_id) VALUES (%s, %s)", (user_id, card.id))
        conn.execute(
            "UPDATE users SET packs_opened = packs_opened + 1, updated_at = now() WHERE id = %s",
            (user_id,),
        )
        return {"awarded": [card.id for card in awarded]}


def ensure_user(conn: Any, user_id: str) -> None:
    conn.execute(
        """
        INSERT INTO users (
          id, balance_cents, total_bets, packs_opened, current_streak, best_streak, risk_managed_wins, oracle_settlements
        ) VALUES (%s, 125000, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (id) DO NOTHING
        """,
        (user_id,),
    )


def validate_card_locks(conn: Any, user_id: str, match_id: str, card_ids: list[str]) -> None:
    if not card_ids:
        return
    rows = conn.execute(
        """
        SELECT card_id, locked_match_id
        FROM user_cards
        WHERE user_id = %s AND card_id = ANY(%s)
        """,
        (user_id, card_ids),
    ).fetchall()
    owned_unlocked = {row["card_id"] for row in rows if row["locked_match_id"] is None}
    missing = [card_id for card_id in card_ids if card_id not in owned_unlocked]
    if missing:
        raise HTTPException(status_code=409, detail={"card_unavailable": missing, "matchId": match_id})

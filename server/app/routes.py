from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .config import get_settings
from .db import get_pool
from .domain import BADGES, DEMO_MATCHES, MARKETS, public_cards, settle_position, starter_pack_pool
from .services.openligadb import fetch_openligadb_matches
from .services.txline import fetch_txline_matches

router = APIRouter()
_platform_tables_ready = False


class PositionContext(BaseModel):
    team: str
    player: str


class PositionPayload(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    matchId: str
    marketId: str
    marketLabel: str
    outcome: Literal["yes", "no"] = "yes"
    stakeCents: int = Field(gt=0)
    oddsBps: int = Field(gt=0)
    context: PositionContext
    cardIds: list[str] = Field(default_factory=list, max_length=3)


class CreateUserPayload(BaseModel):
    id: str | None = None
    displayName: str = Field(default="Prediction Arena Player", min_length=1, max_length=80)
    email: str = Field(default="", max_length=160)
    authProvider: Literal["sui-zklogin", "google", "zksync", "wallet"] = "wallet"
    authSubject: str = Field(default="", max_length=180)
    walletAddress: str = Field(default="", max_length=120)


class AdminCreditPayload(BaseModel):
    targetUserId: str = Field(min_length=1)
    amountCents: int = Field(gt=0)
    note: str = Field(default="Admin credit", max_length=160)


class AdminPointsPayload(BaseModel):
    targetUserId: str = Field(min_length=1)
    points: int = Field(gt=0)
    note: str = Field(default="Event points", max_length=160)


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
            {"id": "txline", "label": "TXLine", "role": "required World Cup fixture, score and odds oracle"},
            {"id": "api-football", "label": "API-FOOTBALL", "role": "optional lineups, logos, richer stats and ratings"},
            {"id": "openligadb", "label": "OpenLigaDB", "role": "free fallback outside launch mode"},
            {"id": "platform", "label": "Prediction Arena", "role": "user balances, positions, volume and rewards"},
            {"id": "manual", "label": "Admin settlement", "role": "future markets until a verified feed is connected"},
        ],
    }


@router.get("/matches")
async def matches() -> list[dict[str, Any]]:
    settings = get_settings()
    txline = await fetch_txline_matches(settings)
    if txline:
        return txline
    if not settings.allow_demo_data:
        raise HTTPException(
            status_code=503,
            detail="real_match_feed_unavailable_configure_txline_credentials",
        )
    openliga = await fetch_openligadb_matches(settings)
    if openliga:
        return openliga
    return DEMO_MATCHES


@router.post("/settle")
async def settle(payload: PositionPayload) -> dict[str, Any]:
    match = await find_match_or_404(payload.matchId)
    try:
        return settle_position(match, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/users")
async def create_user(payload: CreateUserPayload) -> dict[str, Any]:
    validate_auth_payload(payload)
    auth_subject = normalize_auth_subject(payload)
    user_id = payload.id or f"user-{uuid4().hex[:10]}"
    with get_pool().connection() as conn:
        ensure_platform_tables(conn)
        existing = None
        if auth_subject:
            existing = conn.execute(
                "SELECT id FROM users WHERE auth_provider = %s AND auth_subject = %s",
                (payload.authProvider, auth_subject),
            ).fetchone()
        if existing:
            user_id = existing["id"]
        conn.execute(
            """
            INSERT INTO users (
              id, display_name, email, auth_provider, auth_subject, wallet_address, role,
              balance_cents, arena_points, total_bets, packs_opened,
              current_streak, best_streak, risk_managed_wins, oracle_settlements
            ) VALUES (%s, %s, %s, %s, %s, %s, 'player', 0, 0, 0, 0, 0, 0, 0, 0)
            ON CONFLICT (id) DO UPDATE SET
              display_name = EXCLUDED.display_name,
              email = EXCLUDED.email,
              auth_provider = EXCLUDED.auth_provider,
              auth_subject = EXCLUDED.auth_subject,
              wallet_address = EXCLUDED.wallet_address,
              updated_at = now()
            """,
            (
                user_id,
                payload.displayName,
                normalize_email(payload.email),
                payload.authProvider,
                auth_subject,
                payload.walletAddress,
            ),
        )
        return serialize_user_state(conn, user_id)


@router.get("/users/{user_id}/state")
async def user_state(user_id: str) -> dict[str, Any]:
    with get_pool().connection() as conn:
        ensure_user(conn, user_id)
        return serialize_user_state(conn, user_id)


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
              id, user_id, match_id, market_id, market_label, outcome,
              stake_cents, odds_bps, context_json, card_ids_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            """,
            (
                UUID(payload.id),
                user_id,
                payload.matchId,
                payload.marketId,
                payload.marketLabel,
                payload.outcome,
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
        balance_after = user["balance_cents"] - payload.stakeCents
        conn.execute(
            """
            UPDATE users
            SET balance_cents = %s,
                total_bets = total_bets + 1,
                updated_at = now()
            WHERE id = %s
            """,
            (balance_after, user_id),
        )
        insert_ledger(conn, user_id, "stake", -payload.stakeCents, balance_after, payload.id, payload.marketLabel)
        award_points(conn, user_id, "prediction_entry", 10, payload.marketLabel)
        return serialize_user_state(conn, user_id)


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
        insert_ledger(conn, user_id, "pack", 0, current_balance(conn, user_id), None, "Starter Pack opened")
        state = serialize_user_state(conn, user_id)
        state["awarded"] = [card.id for card in awarded]
        return state


@router.post("/users/{user_id}/settle-match/{match_id}")
async def settle_user_match(user_id: str, match_id: str) -> dict[str, Any]:
    match = await find_match_or_404(match_id)
    with get_pool().connection() as conn:
        ensure_user(conn, user_id)
        rows = conn.execute(
            """
            SELECT id::text, match_id, market_id, market_label, outcome, stake_cents, odds_bps,
                   context_json, card_ids_json
            FROM positions
            WHERE user_id = %s AND match_id = %s AND settled = false
            ORDER BY created_at
            FOR UPDATE
            """,
            (user_id, match_id),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=409, detail="no_open_positions")

        settled_positions: list[dict[str, Any]] = []
        for row in rows:
            position = row_to_position(row)
            try:
                settled_position = settle_position(match, position)
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc

            settled_positions.append(settled_position)
            conn.execute(
                """
                UPDATE positions
                SET settled = true,
                    won = %s,
                    gross_payout_cents = %s,
                    net_profit_cents = %s,
                    payout_cents = %s,
                    bonus_cents = %s,
                    activated_card_ids_json = %s::jsonb,
                    oracle_proof = %s,
                    settlement_json = %s::jsonb,
                    settled_at = now()
                WHERE id = %s
                """,
                (
                    settled_position["won"],
                    settled_position["grossPayoutCents"],
                    settled_position["netProfitCents"],
                    settled_position["payoutCents"],
                    settled_position["bonusCents"],
                    json.dumps(settled_position["activatedCardIds"]),
                    settled_position["oracleProof"],
                    json.dumps(settled_position),
                    UUID(settled_position["id"]),
                ),
            )

        payout = sum(position["payoutCents"] for position in settled_positions)
        won_count = sum(1 for position in settled_positions if position["won"])
        user = conn.execute("SELECT balance_cents, current_streak, best_streak FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
        balance_after = int(user["balance_cents"]) + payout
        current_streak = int(user["current_streak"]) + won_count if won_count else 0
        best_streak = max(int(user["best_streak"]), current_streak)
        conn.execute(
            """
            UPDATE users
            SET balance_cents = %s,
                current_streak = %s,
                best_streak = %s,
                oracle_settlements = oracle_settlements + %s,
                updated_at = now()
            WHERE id = %s
            """,
            (balance_after, current_streak, best_streak, len(settled_positions), user_id),
        )
        if payout:
            insert_ledger(conn, user_id, "payout", payout, balance_after, None, f"{won_count}/{len(settled_positions)} positions won")
        if settled_positions:
            award_points(conn, user_id, "oracle_settlement", len(settled_positions) * 25, "TXLine settlement completed")
        if won_count:
            award_points(conn, user_id, "correct_prediction", won_count * 100, f"{won_count} correct predictions")
        conn.execute(
            "UPDATE user_cards SET locked_match_id = NULL WHERE user_id = %s AND locked_match_id = %s",
            (user_id, match_id),
        )
        state = serialize_user_state(conn, user_id)
        state["settledSummary"] = {
            "count": len(settled_positions),
            "won": won_count,
            "payoutCents": payout,
            "bonusCents": sum(position["bonusCents"] for position in settled_positions),
        }
        return state


@router.post("/admin/credits")
async def grant_admin_credits(payload: AdminCreditPayload, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    settings = get_settings()
    if not settings.admin_credit_secret:
        raise HTTPException(status_code=503, detail="admin_credit_secret_not_configured")
    if x_admin_token != settings.admin_credit_secret:
        raise HTTPException(status_code=403, detail="invalid_admin_token")

    with get_pool().connection() as conn:
        ensure_user(conn, payload.targetUserId)
        user = conn.execute("SELECT balance_cents FROM users WHERE id = %s FOR UPDATE", (payload.targetUserId,)).fetchone()
        balance_after = int(user["balance_cents"]) + payload.amountCents
        conn.execute(
            "UPDATE users SET balance_cents = %s, updated_at = now() WHERE id = %s",
            (balance_after, payload.targetUserId),
        )
        insert_ledger(conn, payload.targetUserId, "admin_credit", payload.amountCents, balance_after, None, payload.note)
        return serialize_user_state(conn, payload.targetUserId)


@router.post("/admin/points")
async def grant_admin_points(payload: AdminPointsPayload, x_admin_token: str | None = Header(default=None)) -> dict[str, Any]:
    settings = get_settings()
    if not settings.admin_credit_secret:
        raise HTTPException(status_code=503, detail="admin_credit_secret_not_configured")
    if x_admin_token != settings.admin_credit_secret:
        raise HTTPException(status_code=403, detail="invalid_admin_token")

    with get_pool().connection() as conn:
        ensure_user(conn, payload.targetUserId)
        award_points(conn, payload.targetUserId, "event_bonus", payload.points, payload.note)
        return serialize_user_state(conn, payload.targetUserId)


async def find_match_or_404(match_id: str) -> dict[str, Any]:
    all_matches = await matches()
    match = next((item for item in all_matches if item["id"] == match_id), None)
    if not match:
        match = next((item for item in DEMO_MATCHES if item["id"] == match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="match_not_found")
    return match


def ensure_platform_tables(conn: Any) -> None:
    global _platform_tables_ready
    if _platform_tables_ready:
        return

    conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Prediction Arena Player'")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'wallet'")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_subject TEXT NOT NULL DEFAULT ''")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT NOT NULL DEFAULT ''")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player'")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_points INTEGER NOT NULL DEFAULT 0")
    conn.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'yes'")
    conn.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS gross_payout_cents INTEGER")
    conn.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS net_profit_cents INTEGER")
    conn.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS activated_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb")
    conn.execute("ALTER TABLE positions ADD COLUMN IF NOT EXISTS settlement_json JSONB")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ledger_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          balance_after_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'USDC',
          position_id UUID,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute("ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USDC'")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_time ON ledger_entries(user_id, created_at DESC)")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_identity
          ON users(auth_provider, auth_subject)
          WHERE auth_subject <> ''
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS point_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          points_delta INTEGER NOT NULL,
          points_after INTEGER NOT NULL,
          note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_point_entries_user_time ON point_entries(user_id, created_at DESC)")
    _platform_tables_ready = True


def ensure_user(conn: Any, user_id: str) -> None:
    ensure_platform_tables(conn)
    conn.execute(
        """
        INSERT INTO users (
          id, display_name, email, auth_provider, auth_subject, wallet_address, role,
          balance_cents, arena_points, total_bets, packs_opened,
          current_streak, best_streak, risk_managed_wins, oracle_settlements
        ) VALUES (%s, 'Prediction Arena Player', '', 'wallet', '', '', 'player', 0, 0, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (id) DO NOTHING
        """,
        (user_id,),
    )


def serialize_user_state(conn: Any, user_id: str) -> dict[str, Any]:
    user = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    cards = conn.execute(
        "SELECT instance_id::text, card_id, locked_match_id, acquired_at FROM user_cards WHERE user_id = %s ORDER BY acquired_at DESC",
        (user_id,),
    ).fetchall()
    rows = conn.execute(
        """
        SELECT id::text, match_id, market_id, market_label, outcome, stake_cents, odds_bps,
               context_json, card_ids_json, settled, won, gross_payout_cents, net_profit_cents,
               payout_cents, bonus_cents, activated_card_ids_json, oracle_proof, settlement_json,
               created_at, settled_at
        FROM positions
        WHERE user_id = %s
        ORDER BY created_at DESC
        """,
        (user_id,),
    ).fetchall()
    ledger = conn.execute(
        """
        SELECT id::text, user_id, type, amount_cents, balance_after_cents, currency, note, created_at
        FROM ledger_entries
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 50
        """,
        (user_id,),
    ).fetchall()
    point_ledger = conn.execute(
        """
        SELECT id::text, user_id, type, points_delta, points_after, note, created_at
        FROM point_entries
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 50
        """,
        (user_id,),
    ).fetchall()

    open_positions = [row_to_position(row) for row in rows if not row["settled"]]
    settled_positions = [row_to_settled(row) for row in rows if row["settled"]]
    return {
        "user": {
            "id": user["id"],
            "displayName": user["display_name"],
            "email": user["email"],
            "authProvider": user["auth_provider"],
            "authSubject": user["auth_subject"],
            "walletAddress": user["wallet_address"],
            "role": user["role"],
        },
        "progress": {
            "balanceCents": user["balance_cents"],
            "arenaPoints": user["arena_points"],
            "totalBets": user["total_bets"],
            "packsOpened": user["packs_opened"],
            "currentStreak": user["current_streak"],
            "bestStreak": user["best_streak"],
            "riskManagedWins": user["risk_managed_wins"],
            "oracleSettlements": user["oracle_settlements"],
            "matchBetCounts": match_bet_counts(rows),
        },
        "inventory": [row["card_id"] for row in cards],
        "cards": [dict(row) for row in cards],
        "positions": open_positions,
        "settled": settled_positions,
        "ledger": [row_to_ledger(row) for row in ledger],
        "pointLedger": [row_to_point_ledger(row) for row in point_ledger],
    }


def row_to_position(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "matchId": row["match_id"],
        "marketId": row["market_id"],
        "marketLabel": row["market_label"],
        "outcome": row.get("outcome") or "yes",
        "stakeCents": row["stake_cents"],
        "oddsBps": row["odds_bps"],
        "context": coerce_json(row["context_json"], {}),
        "cardIds": coerce_json(row["card_ids_json"], []),
    }


def row_to_settled(row: dict[str, Any]) -> dict[str, Any]:
    saved = coerce_json(row.get("settlement_json"), None)
    if isinstance(saved, dict):
        return saved
    return {
        **row_to_position(row),
        "settled": True,
        "won": bool(row["won"]),
        "grossPayoutCents": row.get("gross_payout_cents") or 0,
        "netProfitCents": row.get("net_profit_cents") or 0,
        "bonusCents": row.get("bonus_cents") or 0,
        "payoutCents": row.get("payout_cents") or 0,
        "activatedCardIds": coerce_json(row.get("activated_card_ids_json"), []),
        "oracleProof": row.get("oracle_proof") or "",
    }


def row_to_ledger(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "type": row["type"],
        "amountCents": row["amount_cents"],
        "balanceAfterCents": row["balance_after_cents"],
        "currency": row.get("currency") or "USDC",
        "note": row.get("note") or "",
        "createdAt": row["created_at"].isoformat(),
    }


def row_to_point_ledger(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "type": row["type"],
        "pointsDelta": row["points_delta"],
        "pointsAfter": row["points_after"],
        "note": row.get("note") or "",
        "createdAt": row["created_at"].isoformat(),
    }


def match_bet_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["match_id"]] = counts.get(row["match_id"], 0) + 1
    return counts


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


def insert_ledger(
    conn: Any,
    user_id: str,
    entry_type: str,
    amount_cents: int,
    balance_after_cents: int,
    position_id: str | None,
    note: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO ledger_entries (user_id, type, amount_cents, balance_after_cents, currency, position_id, note)
        VALUES (%s, %s, %s, %s, 'USDC', %s, %s)
        """,
        (user_id, entry_type, amount_cents, balance_after_cents, UUID(position_id) if position_id else None, note),
    )


def award_points(conn: Any, user_id: str, entry_type: str, points_delta: int, note: str | None) -> None:
    if points_delta == 0:
        return
    user = conn.execute("SELECT arena_points FROM users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
    points_after = int(user["arena_points"]) + points_delta
    conn.execute(
        "UPDATE users SET arena_points = %s, updated_at = now() WHERE id = %s",
        (points_after, user_id),
    )
    conn.execute(
        """
        INSERT INTO point_entries (user_id, type, points_delta, points_after, note)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (user_id, entry_type, points_delta, points_after, note),
    )


def current_balance(conn: Any, user_id: str) -> int:
    row = conn.execute("SELECT balance_cents FROM users WHERE id = %s", (user_id,)).fetchone()
    return int(row["balance_cents"]) if row else 0


def normalize_auth_subject(payload: CreateUserPayload) -> str:
    if payload.authSubject:
        return payload.authSubject.strip().lower()
    if payload.authProvider in {"sui-zklogin", "google"}:
        return normalize_email(payload.email)
    return payload.walletAddress.strip().lower()


def validate_auth_payload(payload: CreateUserPayload) -> None:
    email = normalize_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="email_required")
    if payload.authProvider in {"wallet", "zksync"} and not payload.walletAddress.strip():
        raise HTTPException(status_code=422, detail="wallet_address_required")


def normalize_email(value: str) -> str:
    return value.strip().lower()


def coerce_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return fallback
    return fallback

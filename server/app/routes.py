from __future__ import annotations

import base64
import binascii
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import get_settings
from .db import get_pool
from .domain import BADGES, DEMO_MATCHES, MARKETS, public_cards, settle_position, starter_pack_pool
from .services.openligadb import fetch_openligadb_matches
from .services.txline import fetch_txline_matches

router = APIRouter()
_platform_tables_ready = False
SESSION_COOKIE = "pa_session"
SESSION_DAYS = 14


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


class GoogleAuthPayload(BaseModel):
    credential: str = Field(min_length=20)
    displayName: str = Field(default="", max_length=80)


class SolanaChallengePayload(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    displayName: str = Field(default="Prediction Arena Player", min_length=1, max_length=80)


class SolanaVerifyPayload(BaseModel):
    challengeId: str = Field(min_length=1)
    walletAddress: str = Field(min_length=32, max_length=64)
    signature: str = Field(min_length=20)


class AdminCreditPayload(BaseModel):
    targetUserId: str = Field(min_length=1)
    amountCents: int = Field(gt=0)
    note: str = Field(default="Admin credit", max_length=160)


class AdminPointsPayload(BaseModel):
    targetUserId: str = Field(min_length=1)
    points: int = Field(gt=0)
    note: str = Field(default="Event points", max_length=160)


class MarketCreatePayload(BaseModel):
    question: str = Field(min_length=12, max_length=180)
    label: str = Field(default="", max_length=80)
    matchId: str = Field(default="", max_length=80)


@router.get("/health")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {"ok": True, "app": "player-prediction-arena", "env": settings.app_env}


@router.get("/catalog")
async def catalog() -> dict[str, Any]:
    markets = admin_seed_markets()
    try:
        with get_pool().connection() as conn:
            ensure_platform_tables(conn)
            markets = [*markets, *load_platform_markets(conn)]
    except Exception:
        pass
    return {
        "cards": public_cards(),
        "badges": BADGES,
        "markets": markets,
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


@router.get("/me")
async def me(request: Request) -> dict[str, Any]:
    with get_pool().connection() as conn:
        user = require_user_session(conn, request)
        return serialize_user_state(conn, user["id"])


@router.post("/auth/google")
async def auth_google(payload: GoogleAuthPayload) -> JSONResponse:
    settings = get_settings()
    claims = await verify_google_credential(payload.credential, settings)
    email = normalize_email(str(claims.get("email") or ""))
    if not email:
        raise HTTPException(status_code=401, detail="google_email_missing")

    display_name = payload.displayName.strip() or str(claims.get("name") or email.split("@")[0])
    auth_subject = f"google:{claims.get('sub')}"
    with get_pool().connection() as conn:
        ensure_platform_tables(conn)
        user_id = upsert_authenticated_user(
            conn,
            email=email,
            provider="google",
            auth_subject=auth_subject,
            display_name=display_name,
            wallet_address="",
            email_verified=True,
        )
        return build_session_response(conn, user_id)


@router.post("/auth/solana/challenge")
async def auth_solana_challenge(payload: SolanaChallengePayload) -> dict[str, Any]:
    email = normalize_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="email_required")

    challenge_id = str(uuid4())
    nonce = secrets.token_urlsafe(18)
    issued_at = datetime.now(timezone.utc).replace(microsecond=0)
    expires_at = issued_at + timedelta(minutes=10)
    message = "\n".join(
        [
            "Prediction Arena wants you to sign in with Solana.",
            "",
            f"Email: {email}",
            f"Nonce: {nonce}",
            f"Issued At: {issued_at.isoformat()}",
        ]
    )

    with get_pool().connection() as conn:
        ensure_platform_tables(conn)
        conn.execute(
            """
            INSERT INTO auth_challenges (id, provider, email, display_name, nonce, message, expires_at)
            VALUES (%s, 'solana', %s, %s, %s, %s, %s)
            """,
            (UUID(challenge_id), email, payload.displayName.strip(), nonce, message, expires_at),
        )
    return {"challengeId": challenge_id, "message": message, "expiresAt": expires_at.isoformat()}


@router.post("/auth/solana/verify")
async def auth_solana_verify(payload: SolanaVerifyPayload) -> JSONResponse:
    try:
        challenge_uuid = UUID(payload.challengeId)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="invalid_challenge_id") from exc

    with get_pool().connection() as conn:
        ensure_platform_tables(conn)
        challenge = conn.execute(
            """
            SELECT id::text, email, display_name, message
            FROM auth_challenges
            WHERE id = %s
              AND provider = 'solana'
              AND consumed_at IS NULL
              AND expires_at > now()
            FOR UPDATE
            """,
            (challenge_uuid,),
        ).fetchone()
        if not challenge:
            raise HTTPException(status_code=401, detail="challenge_expired")

        if not verify_solana_signature(payload.walletAddress, payload.signature, challenge["message"]):
            raise HTTPException(status_code=401, detail="invalid_solana_signature")

        conn.execute("UPDATE auth_challenges SET consumed_at = now() WHERE id = %s", (challenge_uuid,))
        user_id = upsert_authenticated_user(
            conn,
            email=challenge["email"],
            provider="solana",
            auth_subject=f"solana:{payload.walletAddress}",
            display_name=challenge["display_name"] or "Prediction Arena Player",
            wallet_address=payload.walletAddress,
            email_verified=False,
        )
        return build_session_response(conn, user_id)


@router.post("/auth/logout")
async def auth_logout(request: Request) -> JSONResponse:
    token = request.cookies.get(SESSION_COOKIE)
    with get_pool().connection() as conn:
        ensure_platform_tables(conn)
        if token:
            conn.execute(
                "UPDATE sessions SET revoked_at = now() WHERE token_hash = %s",
                (hash_session_token(token),),
            )
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.post("/users")
async def create_user() -> dict[str, Any]:
    raise HTTPException(status_code=410, detail="use_auth_google_or_solana")


@router.post("/markets")
async def create_market(payload: MarketCreatePayload, request: Request) -> dict[str, Any]:
    question = payload.question.strip()
    if not question.endswith("?"):
        question = f"{question}?"
    label = payload.label.strip() or question[:72]
    with get_pool().connection() as conn:
        actor = require_user_session(conn, request)
        market_id = f"market-{uuid4().hex[:12]}"
        conn.execute(
            """
            INSERT INTO platform_markets (
              id, creator_user_id, creator_role, match_id, label, question,
              kind, odds_bps, settlement_key, context_team, data_source, status
            ) VALUES (%s, %s, %s, %s, %s, %s, 'future', 20000, 'manual', 'none', 'manual', 'open')
            """,
            (
                market_id,
                actor["id"],
                "admin" if actor.get("role") == "admin" else "user",
                payload.matchId.strip(),
                label,
                question,
            ),
        )
        row = conn.execute(
            """
            SELECT platform_markets.*, users.display_name
            FROM platform_markets
            JOIN users ON users.id = platform_markets.creator_user_id
            WHERE platform_markets.id = %s
            """,
            (market_id,),
        ).fetchone()
        return {"market": row_to_platform_market(row)}


@router.get("/users/{user_id}/state")
async def user_state(user_id: str, request: Request) -> dict[str, Any]:
    with get_pool().connection() as conn:
        actor = require_user_session(conn, request)
        require_same_user_or_admin(actor, user_id)
        return serialize_user_state(conn, user_id)


@router.post("/users/{user_id}/positions")
async def create_position(user_id: str, payload: PositionPayload, request: Request) -> dict[str, Any]:
    with get_pool().connection() as conn:
        actor = require_user_session(conn, request)
        require_same_user_or_admin(actor, user_id)
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
async def open_pack(user_id: str, request: Request) -> dict[str, Any]:
    with get_pool().connection() as conn:
        actor = require_user_session(conn, request)
        require_same_user_or_admin(actor, user_id)
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
async def settle_user_match(user_id: str, match_id: str, request: Request) -> dict[str, Any]:
    match = await find_match_or_404(match_id)
    with get_pool().connection() as conn:
        actor = require_user_session(conn, request)
        require_same_user_or_admin(actor, user_id)
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
async def grant_admin_credits(
    payload: AdminCreditPayload,
    request: Request,
) -> dict[str, Any]:
    with get_pool().connection() as conn:
        require_admin_session(conn, request)
        user = conn.execute("SELECT balance_cents FROM users WHERE id = %s FOR UPDATE", (payload.targetUserId,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="target_user_not_found")
        balance_after = int(user["balance_cents"]) + payload.amountCents
        conn.execute(
            "UPDATE users SET balance_cents = %s, updated_at = now() WHERE id = %s",
            (balance_after, payload.targetUserId),
        )
        insert_ledger(conn, payload.targetUserId, "admin_credit", payload.amountCents, balance_after, None, payload.note)
        return serialize_user_state(conn, payload.targetUserId)


@router.post("/admin/points")
async def grant_admin_points(
    payload: AdminPointsPayload,
    request: Request,
) -> dict[str, Any]:
    with get_pool().connection() as conn:
        require_admin_session(conn, request)
        user = conn.execute("SELECT id FROM users WHERE id = %s", (payload.targetUserId,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="target_user_not_found")
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
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ")
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
        CREATE TABLE IF NOT EXISTS user_auth_identities (
          provider TEXT NOT NULL,
          auth_subject TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, auth_subject)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user ON user_auth_identities(user_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_challenges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          provider TEXT NOT NULL,
          email TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT 'Prediction Arena Player',
          wallet_address TEXT NOT NULL DEFAULT '',
          nonce TEXT NOT NULL,
          message TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)")
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_markets (
          id TEXT PRIMARY KEY,
          creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          creator_role TEXT NOT NULL DEFAULT 'user',
          match_id TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL,
          question TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'future',
          odds_bps INTEGER NOT NULL DEFAULT 20000,
          settlement_key TEXT NOT NULL DEFAULT 'manual',
          context_team TEXT NOT NULL DEFAULT 'none',
          data_source TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_platform_markets_match ON platform_markets(match_id)")
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
    if not user:
        raise HTTPException(status_code=404, detail="user_not_found")
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


def admin_seed_markets() -> list[dict[str, Any]]:
    return [
        {
            **market,
            "createdBy": market.get("createdBy") or "Prediction Arena",
            "creatorRole": market.get("creatorRole") or "admin",
        }
        for market in MARKETS
    ]


def load_platform_markets(conn: Any) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT platform_markets.*, users.display_name
        FROM platform_markets
        JOIN users ON users.id = platform_markets.creator_user_id
        WHERE platform_markets.status = 'open'
        ORDER BY platform_markets.created_at DESC
        LIMIT 50
        """
    ).fetchall()
    return [row_to_platform_market(row) for row in rows]


def row_to_platform_market(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "label": row["label"],
        "kind": row["kind"],
        "oddsBps": row["odds_bps"],
        "settlementKey": row["settlement_key"],
        "contextTeam": row["context_team"],
        "dataSource": row["data_source"],
        "question": row["question"],
        "createdBy": row.get("display_name") or "Platform user",
        "creatorRole": row["creator_role"],
        "fixtureId": row.get("match_id") or "",
        "marketNote": "User-created market. Settlement requires admin review until an oracle feed is connected.",
    }


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


async def verify_google_credential(credential: str, settings: Any) -> dict[str, Any]:
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="google_client_id_not_configured")
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential})
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="invalid_google_credential")

    data = response.json()
    if data.get("aud") != settings.google_client_id:
        raise HTTPException(status_code=401, detail="google_audience_mismatch")
    if data.get("email_verified") not in (True, "true", "True", "1"):
        raise HTTPException(status_code=401, detail="google_email_not_verified")
    return data


def upsert_authenticated_user(
    conn: Any,
    *,
    email: str,
    provider: str,
    auth_subject: str,
    display_name: str,
    wallet_address: str,
    email_verified: bool,
) -> str:
    settings = get_settings()
    normalized_email = normalize_email(email)
    existing_identity = conn.execute(
        """
        SELECT user_id
        FROM user_auth_identities
        WHERE provider = %s AND auth_subject = %s
        """,
        (provider, auth_subject),
    ).fetchone()
    existing_user = None
    if existing_identity:
        existing_user = conn.execute(
            "SELECT id, role FROM users WHERE id = %s",
            (existing_identity["user_id"],),
        ).fetchone()
    if existing_user and existing_user["role"] == "admin" and not email_verified:
        raise HTTPException(status_code=403, detail="admin_requires_verified_email")
    if not existing_user and email_verified:
        existing_user = conn.execute(
            "SELECT id, role FROM users WHERE email = %s ORDER BY created_at LIMIT 1",
            (normalized_email,),
        ).fetchone()

    user_id = existing_user["id"] if existing_user else f"user-{uuid4().hex[:10]}"
    next_role = role_for_email(settings, normalized_email) if email_verified else "player"
    verified_at = datetime.now(timezone.utc) if email_verified else None
    conn.execute(
        """
        INSERT INTO users (
          id, display_name, email, auth_provider, auth_subject, wallet_address, role,
          balance_cents, arena_points, total_bets, packs_opened,
          current_streak, best_streak, risk_managed_wins, oracle_settlements,
          email_verified_at, last_login_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 0, 0, 0, 0, 0, 0, 0, %s, now())
        ON CONFLICT (id) DO UPDATE SET
          display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
          email = EXCLUDED.email,
          auth_provider = EXCLUDED.auth_provider,
          auth_subject = EXCLUDED.auth_subject,
          wallet_address = CASE
            WHEN EXCLUDED.wallet_address <> '' THEN EXCLUDED.wallet_address
            ELSE users.wallet_address
          END,
          role = CASE
            WHEN users.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin'
            ELSE users.role
          END,
          email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at),
          last_login_at = now(),
          updated_at = now()
        """,
        (
            user_id,
            display_name or "Prediction Arena Player",
            normalized_email,
            provider,
            auth_subject,
            wallet_address,
            next_role,
            verified_at,
        ),
    )
    conn.execute(
        """
        INSERT INTO user_auth_identities (provider, auth_subject, user_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (provider, auth_subject) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          updated_at = now()
        """,
        (provider, auth_subject, user_id),
    )
    return user_id


def build_session_response(conn: Any, user_id: str) -> JSONResponse:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute(
        """
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES (%s, %s, %s)
        """,
        (user_id, hash_session_token(token), expires_at),
    )
    response = JSONResponse(serialize_user_state(conn, user_id))
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        path="/",
        samesite="lax",
        secure=get_settings().app_env == "production",
    )
    return response


def require_user_session(conn: Any, request: Request) -> dict[str, Any]:
    ensure_platform_tables(conn)
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="login_required")
    user = conn.execute(
        """
        SELECT users.*
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = %s
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > now()
        """,
        (hash_session_token(token),),
    ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="login_required")
    return user


def require_same_user_or_admin(actor: dict[str, Any], user_id: str) -> None:
    if actor["id"] != user_id and actor.get("role") != "admin":
        raise HTTPException(status_code=403, detail="forbidden")


def require_admin_session(conn: Any, request: Request) -> dict[str, Any]:
    actor = require_user_session(conn, request)
    if actor.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin_login_required")
    return actor


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def role_for_email(settings: Any, email: str) -> str:
    admin_emails = {item.strip().lower() for item in settings.admin_emails.split(",") if item.strip()}
    return "admin" if normalize_email(email) in admin_emails else "player"


def verify_solana_signature(public_key: str, signature: str, message: str) -> bool:
    try:
        from nacl.exceptions import BadSignatureError
        from nacl.signing import VerifyKey
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="solana_signature_verifier_not_installed") from exc

    try:
        public_key_bytes = decode_base58(public_key)
        signature_bytes = base64.b64decode(signature, validate=True)
    except (ValueError, TypeError, binascii.Error):
        return False
    if len(public_key_bytes) != 32 or len(signature_bytes) != 64:
        return False
    try:
        VerifyKey(public_key_bytes).verify(message.encode("utf-8"), signature_bytes)
        return True
    except BadSignatureError:
        return False


def decode_base58(value: str) -> bytes:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = 0
    for char in value:
        index = alphabet.find(char)
        if index < 0:
            raise ValueError("invalid_base58")
        number = number * 58 + index
    output = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    leading_zeroes = len(value) - len(value.lstrip("1"))
    return b"\0" * leading_zeroes + output


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

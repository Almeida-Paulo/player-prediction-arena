CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 125000,
  total_bets INTEGER NOT NULL DEFAULT 0,
  packs_opened INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  risk_managed_wins INTEGER NOT NULL DEFAULT 0,
  oracle_settlements INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_cards (
  instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  locked_match_id TEXT,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_cards_user_id ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_locked_match_id ON user_cards(locked_match_id);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  market_id TEXT NOT NULL,
  market_label TEXT NOT NULL,
  stake_cents INTEGER NOT NULL CHECK (stake_cents > 0),
  odds_bps INTEGER NOT NULL CHECK (odds_bps > 0),
  context_json JSONB NOT NULL,
  card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  settled BOOLEAN NOT NULL DEFAULT false,
  won BOOLEAN,
  payout_cents INTEGER,
  bonus_cents INTEGER,
  oracle_proof TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_positions_user_match ON positions(user_id, match_id);
CREATE INDEX IF NOT EXISTS idx_positions_settled ON positions(settled);

CREATE TABLE IF NOT EXISTS earned_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS txline_odds_snapshots (
  fixture_id TEXT PRIMARY KEY,
  odds_json JSONB NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ts BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
);

CREATE INDEX IF NOT EXISTS idx_txline_odds_history_fixture_time
  ON txline_odds_history(fixture_id, source_ts DESC);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Prediction Arena Player',
  email TEXT NOT NULL DEFAULT '',
  auth_provider TEXT NOT NULL DEFAULT 'wallet',
  auth_subject TEXT NOT NULL DEFAULT '',
  wallet_address TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'player',
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  arena_points INTEGER NOT NULL DEFAULT 0,
  total_bets INTEGER NOT NULL DEFAULT 0,
  packs_opened INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  risk_managed_wins INTEGER NOT NULL DEFAULT 0,
  oracle_settlements INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT 'Prediction Arena Player';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_bets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS packs_opened INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS best_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_managed_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_settlements INTEGER NOT NULL DEFAULT 0;

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
  outcome TEXT NOT NULL DEFAULT 'yes',
  stake_cents INTEGER NOT NULL CHECK (stake_cents > 0),
  odds_bps INTEGER NOT NULL CHECK (odds_bps > 0),
  context_json JSONB NOT NULL,
  card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  settled BOOLEAN NOT NULL DEFAULT false,
  won BOOLEAN,
  gross_payout_cents INTEGER,
  net_profit_cents INTEGER,
  payout_cents INTEGER,
  bonus_cents INTEGER,
  activated_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  oracle_proof TEXT,
  settlement_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

ALTER TABLE positions ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'yes';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS gross_payout_cents INTEGER;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS net_profit_cents INTEGER;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS activated_card_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS settlement_json JSONB;

CREATE INDEX IF NOT EXISTS idx_positions_user_match ON positions(user_id, match_id);
CREATE INDEX IF NOT EXISTS idx_positions_settled ON positions(settled);

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
);

ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USDC';

CREATE INDEX IF NOT EXISTS idx_ledger_entries_user_time
  ON ledger_entries(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_identity
  ON users(auth_provider, auth_subject)
  WHERE auth_subject <> '';

CREATE TABLE IF NOT EXISTS user_auth_identities (
  provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, auth_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user
  ON user_auth_identities(user_id);

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
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry
  ON auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS point_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  points_delta INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_entries_user_time
  ON point_entries(user_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS match_snapshots (
  fixture_id TEXT PRIMARY KEY,
  match_json JSONB NOT NULL,
  source TEXT NOT NULL DEFAULT 'txline',
  status TEXT,
  start_time BIGINT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_snapshots_start_time
  ON match_snapshots(start_time DESC);

# API Setup

## TXLine is required

Production World Cup fixtures must come from TXLine.

Required environment values:

```env
TXLINE_API_BASE=https://txline.txodds.com
TXLINE_API_TOKEN=your_activated_api_token
TXLINE_GUEST_JWT=
TXLINE_COMPETITION_ID=
ALLOW_DEMO_DATA=false
```

`TXLINE_API_TOKEN` is the activated API token returned by `/api/token/activate`.

`TXLINE_GUEST_JWT` can be left empty. The backend will call `/auth/guest/start` and use the returned JWT as the Bearer token. If you already have a fresh guest JWT, you can paste it in the env file.

Data requests use both:

```text
Authorization: Bearer <guest_jwt>
X-Api-Token: <activated_api_token>
```

## Free World Cup activation flow

1. Choose one network and keep it consistent.
2. Mainnet free service levels:
   - `1`: World Cup and International Friendlies with 60-second delay.
   - `12`: World Cup and International Friendlies real-time.
3. Devnet free service level:
   - `1`.
4. Subscribe on-chain with the selected service level.
5. Call `POST /auth/guest/start` on the matching host.
6. Sign the activation message with the same wallet that submitted the subscription.
7. Call `POST /api/token/activate`.
8. Paste the returned token into `TXLINE_API_TOKEN`.

References:

- https://txline-docs.txodds.com/documentation/quickstart
- https://txline-docs.txodds.com/documentation/worldcup
- https://txline-docs.txodds.com/documentation/examples/fetching-snapshots
- https://txline-docs.txodds.com/documentation/scores/schedule

## Lineups, logos, and richer stats

TXLine covers the required World Cup fixture, scores, odds, and score feed path. Starting XI, team artwork, richer team statistics, and player ratings require a second provider because TXLine does not expose lineups in the current integration.

Current optional provider:

- API-FOOTBALL / API-SPORTS.
- Free plan: 100 requests per day.
- Useful endpoint: `GET /fixtures`.
- Useful endpoint: `GET /fixtures/lineups?fixture=...`.
- The backend maps TXLine fixtures to API-FOOTBALL fixtures by date, home team, and away team.

Add these values to `server/.env` when you have the key:

```env
API_FOOTBALL_BASE=https://v3.football.api-sports.io
API_FOOTBALL_KEY=your_api_football_key
API_FOOTBALL_LEAGUE_ID=1
API_FOOTBALL_SEASON=2026
```

The provider is optional. If `API_FOOTBALL_KEY` is empty, the app still loads TXLine fixtures and odds, but the lineup panel remains in a pending state.

References:

- https://www.api-football.com/documentation-beta
- https://api-sports.io/sports/football

Production rule: do not display fake lineup players or fake logos while this mapping is missing.

## Platform USDC credits

The platform has internal dollar-denominated test credits in PostgreSQL. The Rewards balance presents this as an internal USDC-style balance for the hackathon demo. These are not real USDC transfers yet and there is no checkout flow.

New users start with `0`. An admin distributes internal credits through:

```text
POST /api/admin/credits
```

The endpoint requires:

```env
ADMIN_EMAILS=server-only-admin@example.com
```

Only the backend reads `ADMIN_EMAILS`. Do not expose admin emails or server env files through the frontend bundle. Admin role is granted only after Google verifies the email address; Solana wallet login alone is treated as a player account because it does not verify email ownership.

Every credit, stake, payout, and adjustment is recorded in `ledger_entries` with `currency='USDC'` because the internal balance is presented as USDC in Rewards.

Arena Points are separate from the dollar/USDC-style balance. They are stored on `users.arena_points` and recorded in `point_entries`. The current scoring model is:

- `+10 AP` for placing a prediction.
- `+25 AP` for each TXLine-backed settlement.
- `+100 AP` for each correct prediction.

These points power ranking and engagement rewards; they are not a withdrawable balance.

Admins can also grant event points through:

```text
POST /api/admin/points
```

Admin endpoints require the request cookie to belong to an authenticated admin user whose Google-verified email is listed in `ADMIN_EMAILS`.

## Account login

The current app creates real platform users through:

- Google Identity Services: the frontend receives a Google ID token and the backend verifies it against `GOOGLE_CLIENT_ID`.
- Solana wallet signing: the backend creates a nonce challenge, the browser wallet signs the message, and the backend verifies the Ed25519 signature.

Required env for Google:

```env
GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
VITE_GOOGLE_CLIENT_ID=your-google-oauth-web-client-id
```

Required Python dependency for Solana signature verification:

```bash
pip install -r server/requirements.txt
```

The database stores `email`, `auth_provider`, `auth_subject`, `wallet_address`, sessions, and auth identities. Public `POST /api/users` is disabled; account creation must go through `/api/auth/google` or `/api/auth/solana/verify`. Unverified Solana emails are not used to attach an existing account or assign admin access.

## Real vs platform-generated data

- Real match fixtures, scores, status, and odds: TXLine/TXODDS.
- Real lineups, logos, statistics, events, player ratings, and available transfers: API-FOOTBALL when configured.
- Platform data: admin-created seed markets, user-created manual markets, users, auth method, email, internal balances shown as USDC in Rewards, Arena Points, positions, card inventory, ledger, volume, leaderboard, and prediction history.
- Synthetic seed data: only the initial liquidity/activity used to make the hackathon market graph readable before enough real users trade.

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

## Platform credits

The platform has internal test credits in PostgreSQL. These are not blockchain tokens.

New users start with `0` credits. An admin distributes credits through:

```text
POST /api/admin/credits
```

The endpoint requires:

```env
ADMIN_CREDIT_SECRET=choose-a-long-random-secret
```

The frontend sends this value as:

```text
X-Admin-Token: <ADMIN_CREDIT_SECRET>
```

Every credit, stake, payout, and starter pack action is recorded in `ledger_entries`.

## Real vs platform-generated data

- Real match fixtures, scores, status, and odds: TXLine/TXODDS.
- Real lineups, logos, statistics, and ratings: API-FOOTBALL when configured.
- Platform data: users, balances, positions, card inventory, ledger, volume, leaderboard, and prediction history.
- Synthetic seed data: only the initial liquidity/activity used to make the hackathon market graph readable before enough real users trade.

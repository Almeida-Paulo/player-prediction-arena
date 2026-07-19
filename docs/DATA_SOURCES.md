# Data Sources

## Real sports data

- TXLine/TXODDS is the required source for World Cup fixtures, match identity, kickoff time, status, score path, and 1X2 consensus odds.
- API-FOOTBALL is optional and enriches the TXLine fixture with lineups, team logos, match statistics, events, and player ratings when `API_FOOTBALL_KEY` is configured.
- TXLine match snapshots are persisted in PostgreSQL so completed matches can remain visible as history after they disappear from the current live snapshot.
- The app must not render fake players, fake lineups, fake scores, or fake team logos as if they came from an API.

## Platform data

These records are created by Prediction Arena and stored in PostgreSQL:

- users
- auth sessions, account provider, email, auth subject, and wallet address
- balances
- ledger entries
- Arena Points and point ledger entries
- positions
- card inventory
- opened packs
- settled predictions
- leaderboard data derived from platform users

New users start with zero internal balance. Rewards presents that balance as an internal USDC-style balance. The admin distributes test credits through `POST /api/admin/credits`, protected by an authenticated admin session whose Google-verified email is listed in server-side `ADMIN_EMAILS`.

Arena Points are separate from internal USDC. They are awarded for prediction participation, correct predictions, and settlement events, and are used for ranking and engagement rewards.

## Synthetic seed data

The frontend still has deterministic seed activity so the hackathon demo can show a readable market chart before enough real users trade. This seed is platform liquidity/activity only. It is not sports data and must not be described as TXLine or API-FOOTBALL data.

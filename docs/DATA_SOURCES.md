# Data Sources

## Real sports data

- TXLine/TXODDS is the required source for World Cup fixtures, match identity, kickoff time, status, score path, and 1X2 consensus odds.
- API-FOOTBALL is optional and enriches the TXLine fixture with lineups, team logos, match statistics, events, and player ratings when `API_FOOTBALL_KEY` is configured.
- The app must not render fake players, fake lineups, fake scores, or fake team logos as if they came from an API.

## Platform data

These records are created by Prediction Arena and stored in PostgreSQL:

- users
- account provider, email, auth subject, and wallet address
- balances
- ledger entries
- Arena Points and point ledger entries
- positions
- card inventory
- opened packs
- settled predictions
- leaderboard data derived from platform users

New users start with zero internal USDC. The admin distributes test USDC through `POST /api/admin/credits`, protected by `ADMIN_CREDIT_SECRET`.

Arena Points are separate from internal USDC. They are awarded for prediction participation, correct predictions, and settlement events, and are used for ranking and engagement rewards.

## Synthetic seed data

The frontend still has deterministic seed activity so the hackathon demo can show a readable market chart before enough real users trade. This seed is platform liquidity/activity only. It is not sports data and must not be described as TXLine or API-FOOTBALL data.

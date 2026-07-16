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

TXLine covers the required World Cup fixture, scores, odds, and score feed path. Starting XI, team artwork, and richer player ratings may require a second provider.

Current free candidate:

- TheSportsDB v1 free key is `123`.
- Useful endpoints include `lookuplineup.php?id=...` and `lookupeventstats.php?id=...`.
- The hard part is mapping a TXLine `fixtureId` to a TheSportsDB `idEvent` without a paid or maintained mapping table.

Reference:

- https://www.thesportsdb.com/documentation

Production rule: do not display fake lineup players or fake logos while this mapping is missing.

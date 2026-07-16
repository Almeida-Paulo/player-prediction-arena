# Player Prediction Arena Design Notes

## Product direction

Launch surface: one English home screen for World Cup prediction markets.

The page should feel closer to Kalshi/Polymarket plus a football match center:

- Dense market board on the left.
- Match center in the middle.
- Trade ticket, wallet state, cards, positions, and badges on the right.
- No marketing hero and no extra top-level tabs until there are enough features.

## Visual rules

- Use a light operational palette: white surfaces, neutral background, black text, green/blue/amber/coral accents.
- Keep panels compact and scannable.
- Use 8px radius or less.
- Avoid generic gradient hero sections, decorative blobs, nested cards, oversized headings inside compact panels, and fake explanatory UI copy.
- Show unavailable real-data sections honestly instead of filling them with mock players or fake logos.

## Data display rules

- Matches, scores, fixtures, events, logos, stats, and lineups must come from connected APIs.
- If the API does not return a field, the UI must show a pending/unavailable state.
- The app can keep product definitions locally: card rules, badge rules, and starter-pack rules.
- Production should not fall back to demo fixtures. Use `ALLOW_DEMO_DATA=false`.

## Cards and NFTs

First release: off-chain card instances in the database with asset metadata and deterministic card logic.

Rationale:

- Faster for the hackathon.
- Avoids wallet friction before the core prediction loop is validated.
- Lets us balance rewards without deploying new contracts.
- Still leaves a clean path to mint on-chain later.

Later on-chain path:

- Keep `card_id` as the product definition.
- Add `token_mint`, `chain`, `metadata_uri`, and `owner_wallet` to card instances.
- Mint only after the reward math and settlement sources are stable.

## Skill usage

The external design skill suggested is:

```bash
npx skills add https://github.com/leonxlnx/taste-skill --skill design-taste-frontend
```

After installing, restart Codex so it can discover the new skill.

For this project, use the skill as a design review lens, not as a blind generator:

- Read the product brief first.
- Calibrate for an operational betting/prediction interface, not a portfolio or landing page.
- Reject generic AI design patterns.
- Audit text fit, contrast, responsive layout, and information density before shipping.

Reference: https://www.skills.sh/leonxlnx/taste-skill/design-taste-frontend

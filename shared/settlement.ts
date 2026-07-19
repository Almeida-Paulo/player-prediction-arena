import { cards } from "./cards";
import { markets } from "./demo-data";
import type {
  CardDefinition,
  MarketDefinition,
  MatchSnapshot,
  PositionContext,
  PositionInput,
  SettledPosition,
} from "./types";

export function settlePosition(match: MatchSnapshot, position: PositionInput): SettledPosition {
  const market = markets.find((item) => item.id === position.marketId);
  if (!market) {
    throw new Error(`Unknown market: ${position.marketId}`);
  }
  if (!canSettleMarket(market, match)) {
    throw new Error(`Market cannot be settled yet: ${market.id}`);
  }

  const resolvedYes = resolveMarket(market, match);
  const won = position.outcome === "no" ? !resolvedYes : resolvedYes;
  if (!won) {
    return {
      ...position,
      outcome: position.outcome ?? "yes",
      settled: true,
      won: false,
      grossPayoutCents: 0,
      netProfitCents: 0,
      bonusCents: 0,
      payoutCents: 0,
      activatedCardIds: [],
      oracleProof: match.oracleProof ?? `txline:${match.id}:pending-proof`,
    };
  }

  const grossPayoutCents = Math.floor((position.stakeCents * position.oddsBps) / 10000);
  const netProfitCents = Math.max(0, grossPayoutCents - position.stakeCents);
  const activeCards = position.cardIds
    .map((cardId) => cards.find((card) => card.id === cardId))
    .filter((card): card is CardDefinition => Boolean(card))
    .filter((card) => resolveCard(card, match, position.context));
  const bonusBps = activeCards.reduce((sum, card) => sum + card.bonusBps, 0);
  const bonusCents = Math.floor((netProfitCents * bonusBps) / 10000);

  return {
    ...position,
    outcome: position.outcome ?? "yes",
    settled: true,
    won: true,
    grossPayoutCents,
    netProfitCents,
    bonusCents,
    payoutCents: grossPayoutCents + bonusCents,
    activatedCardIds: activeCards.map((card) => card.id),
    oracleProof: match.oracleProof ?? `txline:${match.id}:pending-proof`,
  };
}

export function canSettleMarket(market: MarketDefinition, match: MatchSnapshot): boolean {
  if (market.settlementKey === "manual") return false;
  if (match.status !== "FINAL") return false;
  if (market.dataSource === "api-football" && !match.detailSource) return false;
  if (["home_first_goal", "away_first_goal", "any_hat_trick", "any_poker_trick"].includes(market.settlementKey)) {
    return match.events.length > 0;
  }
  return true;
}

export function resolveMarket(market: MarketDefinition, match: MatchSnapshot): boolean {
  switch (market.settlementKey) {
    case "home_win":
      return teamGoals(match, match.home) > teamGoals(match, match.away);
    case "away_win":
      return teamGoals(match, match.away) > teamGoals(match, match.home);
    case "draw_after_90":
      return teamGoals(match, match.home) === teamGoals(match, match.away);
    case "home_scores":
      return teamGoals(match, match.home) > 0;
    case "away_scores":
      return teamGoals(match, match.away) > 0;
    case "both_teams_score":
      return teamGoals(match, match.home) > 0 && teamGoals(match, match.away) > 0;
    case "over_2_5_goals":
      return totalGoals(match) >= 3;
    case "over_3_5_goals":
      return totalGoals(match) >= 4;
    case "under_2_5_goals":
      return totalGoals(match) <= 2;
    case "home_2plus_goals":
      return teamGoals(match, match.home) >= 2;
    case "away_2plus_goals":
      return teamGoals(match, match.away) >= 2;
    case "home_first_goal":
      return firstGoalTeam(match) === match.home;
    case "away_first_goal":
      return firstGoalTeam(match) === match.away;
    case "home_clean_sheet":
      return goalsAgainst(match, match.home) === 0;
    case "away_clean_sheet":
      return goalsAgainst(match, match.away) === 0;
    case "any_hat_trick":
      return maxGoalsByPlayer(match) >= 3;
    case "any_poker_trick":
      return maxGoalsByPlayer(match) >= 4;
    case "penalty_shootout":
      return match.events.some((event) => event.tags.includes("penalty-shootout"));
    case "extra_time":
      return match.events.some((event) => event.minute > 90 || event.tags.includes("extra-time"));
    case "home_possession_60":
      return teamStats(match, match.home).possession > 60;
    case "away_possession_60":
      return teamStats(match, match.away).possession > 60;
    case "home_most_corners":
      return teamStats(match, match.home).cornersAgainst < teamStats(match, match.away).cornersAgainst;
    case "away_most_corners":
      return teamStats(match, match.away).cornersAgainst < teamStats(match, match.home).cornersAgainst;
    case "mom_home_team":
      return scorerTeam(match, match.mom) === match.home;
    case "mom_away_team":
      return scorerTeam(match, match.mom) === match.away;
    default:
      return false;
  }
}

export function resolveCard(card: CardDefinition, match: MatchSnapshot, context: PositionContext): boolean {
  switch (card.settlementKey) {
    case "goal":
      return teamGoals(match, context.team) > 0;
    case "clean_sheet":
      return goalsAgainst(match, context.team) === 0;
    case "hat_trick":
      return maxGoalsByPlayer(match, context.team) >= 3;
    case "last_touch":
      return lastGoalChangedResult(match, context.team);
    case "steamroller":
      return goalDifference(match, context.team) >= 4;
    case "bicycle_goal":
      return hasTaggedGoal(match, context.team, "bicycle");
    case "olympic_goal":
      return hasTaggedGoal(match, context.team, "olympic");
    case "poker_trick":
      return maxGoalsByPlayer(match, context.team) >= 4;
    case "penta_trick":
      return maxGoalsByPlayer(match, context.team) >= 5;
    case "mom":
      return match.mom === context.player;
    case "tiki_taka":
      return teamStats(match, context.team).possession > 60;
    case "catenaccio": {
      const stats = teamStats(match, context.team);
      return (
        goalsAgainst(match, context.team) === 0 &&
        (stats.possession < 45 || stats.shotsAgainst >= 12 || stats.cornersAgainst >= 6)
      );
    }
    case "carrousel":
      return uniqueScorers(match, context.team) >= 4;
    case "jogo_bonito":
      return teamGoals(match, context.team) >= 3 && goalDifference(match, context.team) >= 3;
    default:
      return false;
  }
}

export function topRatedPlayer(match: MatchSnapshot): string {
  return Object.entries(match.ratings).sort((a, b) => b[1] - a[1])[0]?.[0] ?? match.home;
}

export function teamGoals(match: MatchSnapshot, team: string): number {
  return match.score[team] ?? 0;
}

export function totalGoals(match: MatchSnapshot): number {
  return teamGoals(match, match.home) + teamGoals(match, match.away);
}

export function goalsAgainst(match: MatchSnapshot, team: string): number {
  const opponent = team === match.home ? match.away : match.home;
  return teamGoals(match, opponent);
}

export function goalDifference(match: MatchSnapshot, team: string): number {
  return teamGoals(match, team) - goalsAgainst(match, team);
}

export function teamStats(match: MatchSnapshot, team: string) {
  return match.stats[team] ?? { possession: 50, shotsAgainst: 0, cornersAgainst: 0 };
}

export function maxGoalsByPlayer(match: MatchSnapshot, team?: string): number {
  const counts = match.events
    .filter((event) => event.type === "goal" && (!team || event.team === team))
    .reduce<Record<string, number>>((acc, event) => {
      acc[event.player] = (acc[event.player] ?? 0) + 1;
      return acc;
    }, {});
  return Math.max(0, ...Object.values(counts));
}

function firstGoalTeam(match: MatchSnapshot): string | null {
  const first = match.events
    .filter((event) => event.type === "goal")
    .sort((a, b) => a.minute - b.minute)[0];
  return first?.team ?? null;
}

export function uniqueScorers(match: MatchSnapshot, team: string): number {
  return new Set(
    match.events
      .filter((event) => event.type === "goal" && event.team === team)
      .map((event) => event.player),
  ).size;
}

function hasTaggedGoal(match: MatchSnapshot, team: string, tag: string): boolean {
  return match.events.some(
    (event) => event.type === "goal" && event.team === team && event.tags.includes(tag),
  );
}

function lastGoalChangedResult(match: MatchSnapshot, team: string): boolean {
  const goals = match.events.filter((event) => event.type === "goal");
  const last = goals[goals.length - 1];
  return Boolean(last && last.team === team && last.tags.includes("decisive"));
}

function scorerTeam(match: MatchSnapshot, player: string): string | null {
  const event = match.events.find((item) => item.type === "goal" && item.player === player);
  return event?.team ?? null;
}

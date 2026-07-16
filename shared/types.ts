export type CardType = "moment" | "power" | "historic";
export type CardRarity = "basic" | "rare" | "legendary";

export type CardSettlementKey =
  | "goal"
  | "clean_sheet"
  | "hat_trick"
  | "last_touch"
  | "steamroller"
  | "bicycle_goal"
  | "olympic_goal"
  | "poker_trick"
  | "penta_trick"
  | "mom"
  | "tiki_taka"
  | "catenaccio"
  | "carrousel"
  | "jogo_bonito";

export interface CardDefinition {
  id: string;
  type: CardType;
  name: string;
  rarity: CardRarity;
  bonusBps: number;
  condition: string;
  settlementKey: CardSettlementKey;
  dataNeeds: string[];
}

export interface SkillBadgeDefinition {
  id: string;
  name: string;
  condition: string;
  category: "onboarding" | "prediction" | "risk" | "oracle";
}

export type MarketSettlementKey =
  | "home_win"
  | "away_win"
  | "home_scores"
  | "home_clean_sheet"
  | "any_hat_trick"
  | "mom_home_team";

export interface MarketDefinition {
  id: string;
  label: string;
  kind: "result" | "goal" | "defense" | "player" | "rating";
  oddsBps: number;
  settlementKey: MarketSettlementKey;
}

export interface TeamStats {
  possession: number;
  shotsAgainst: number;
  cornersAgainst: number;
}

export interface MatchEvent {
  type: "goal" | "card" | "substitution";
  team: string;
  player: string;
  minute: number;
  tags: string[];
}

export interface MatchSnapshot {
  id: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  minute: string;
  status: "SCHEDULED" | "LIVE" | "FINAL";
  score: Record<string, number>;
  stats: Record<string, TeamStats>;
  ratings: Record<string, number>;
  mom: string;
  source: "txline" | "openligadb" | "statsbomb" | "demo";
  oracleProof?: string;
  events: MatchEvent[];
}

export interface PositionContext {
  team: string;
  player: string;
}

export interface PositionInput {
  id: string;
  matchId: string;
  marketId: string;
  marketLabel: string;
  stakeCents: number;
  oddsBps: number;
  context: PositionContext;
  cardIds: string[];
}

export interface SettledPosition extends PositionInput {
  settled: true;
  won: boolean;
  grossPayoutCents: number;
  netProfitCents: number;
  bonusCents: number;
  payoutCents: number;
  activatedCardIds: string[];
  oracleProof: string;
}

export interface UserProgress {
  balanceCents: number;
  totalBets: number;
  packsOpened: number;
  currentStreak: number;
  bestStreak: number;
  riskManagedWins: number;
  oracleSettlements: number;
  matchBetCounts: Record<string, number>;
}

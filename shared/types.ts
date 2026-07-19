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
  | "draw_after_90"
  | "home_scores"
  | "away_scores"
  | "both_teams_score"
  | "over_2_5_goals"
  | "over_3_5_goals"
  | "under_2_5_goals"
  | "home_2plus_goals"
  | "away_2plus_goals"
  | "home_first_goal"
  | "away_first_goal"
  | "home_clean_sheet"
  | "away_clean_sheet"
  | "any_hat_trick"
  | "any_poker_trick"
  | "penalty_shootout"
  | "extra_time"
  | "home_possession_60"
  | "away_possession_60"
  | "home_most_corners"
  | "away_most_corners"
  | "mom_home_team"
  | "mom_away_team"
  | "manual";

export interface MarketDefinition {
  id: string;
  label: string;
  kind: "result" | "goal" | "defense" | "player" | "rating" | "stats" | "future";
  oddsBps: number;
  settlementKey: MarketSettlementKey;
  question?: string;
  scope?: "all" | "final" | "third-place" | "world-cup";
  contextTeam?: "home" | "away" | "none";
  dataSource?: "txline" | "api-football" | "platform" | "manual";
  marketNote?: string;
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

export interface LineupPlayer {
  id?: string;
  name: string;
  number?: number;
  position?: string;
  photoUrl?: string;
  rating?: number;
  x?: number;
  y?: number;
}

export interface TeamLineup {
  formation?: string;
  starters: LineupPlayer[];
  bench?: LineupPlayer[];
}

export interface TxLineOddsEntry {
  id: string;
  market: string;
  selection: string;
  shortLabel?: string;
  selectionRole?: "home" | "draw" | "away" | "other";
  sortOrder?: number;
  decimal?: number;
  american?: number;
  impliedProbability?: number;
  status?: string;
  updatedAt?: string | number;
  source: "txline";
}

export interface MatchSnapshot {
  id: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  competition?: string;
  round?: string;
  startTime?: string | number;
  minute: string;
  status: "SCHEDULED" | "LIVE" | "FINAL";
  score: Record<string, number>;
  stats: Record<string, TeamStats>;
  ratings: Record<string, number>;
  mom: string;
  source: "txline" | "openligadb" | "statsbomb" | "demo";
  detailSource?: "api-football" | "openligadb" | "statsbomb";
  detailProviderFixtureId?: string;
  oracleProof?: string;
  events: MatchEvent[];
  odds?: TxLineOddsEntry[];
  lineups?: Record<string, TeamLineup>;
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
  outcome?: "yes" | "no";
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
  arenaPoints: number;
  totalBets: number;
  packsOpened: number;
  currentStreak: number;
  bestStreak: number;
  riskManagedWins: number;
  oracleSettlements: number;
  matchBetCounts: Record<string, number>;
}

export interface PlatformLedgerEntry {
  id: string;
  userId: string;
  type: "admin_credit" | "stake" | "payout" | "pack" | "adjustment";
  amountCents: number;
  balanceAfterCents: number;
  currency: "USDC";
  note?: string;
  createdAt: string;
}

export interface PlatformPointEntry {
  id: string;
  userId: string;
  type: "prediction_entry" | "correct_prediction" | "oracle_settlement" | "event_bonus" | "adjustment";
  pointsDelta: number;
  pointsAfter: number;
  note?: string;
  createdAt: string;
}

export type AuthProvider = "sui-zklogin" | "google" | "zksync" | "wallet";

export interface PlatformUserState {
  user: {
    id: string;
    displayName: string;
    email: string;
    authProvider: AuthProvider;
    authSubject: string;
    walletAddress: string;
    role: "admin" | "player";
  };
  progress: UserProgress;
  inventory: string[];
  positions: PositionInput[];
  settled: SettledPosition[];
  ledger: PlatformLedgerEntry[];
  pointLedger: PlatformPointEntry[];
}

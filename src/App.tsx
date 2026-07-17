import {
  BadgeCheck,
  BarChart3,
  Bookmark,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Gift,
  HelpCircle,
  History,
  LifeBuoy,
  Link2,
  LockKeyhole,
  Medal,
  PackageOpen,
  Search,
  ShieldCheck,
  Trophy,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import predictionLogo from "../assets/Prediction-Arena-logo.png";
import { skillBadges } from "../shared/badges";
import { cards as cardCatalog, starterPackPool } from "../shared/cards";
import { markets as marketCatalog } from "../shared/demo-data";
import { teamStats, topRatedPlayer } from "../shared/settlement";
import type {
  CardDefinition,
  CardType,
  MarketDefinition,
  MatchSnapshot,
  PositionInput,
  SettledPosition,
  TeamLineup,
  UserProgress,
} from "../shared/types";
import { getCatalog, getMatches, settlePositionApi } from "./services/api";

interface AppState {
  connected: boolean;
  progress: UserProgress;
  inventory: string[];
  positions: PositionInput[];
  settled: SettledPosition[];
  locks: Record<string, string[]>;
  selectedMatchId: string;
  selectedMarketId: string;
  toast: string;
}

type AccountView = "home" | "profile" | "rewards" | "leaderboard" | "help";

interface MarketItem {
  match: MatchSnapshot;
  market: MarketDefinition;
}

interface MarketActivity {
  volumeCents: number;
  positions: number;
  bettors: number;
  wonCents: number;
}

const STORAGE_KEY = "player-prediction-arena-ts";

const initialProgress: UserProgress = {
  balanceCents: 125000,
  totalBets: 0,
  packsOpened: 0,
  currentStreak: 0,
  bestStreak: 0,
  riskManagedWins: 0,
  oracleSettlements: 0,
  matchBetCounts: {},
};

const initialState: AppState = {
  connected: false,
  progress: initialProgress,
  inventory: [],
  positions: [],
  settled: [],
  locks: {},
  selectedMatchId: "",
  selectedMarketId: "home-win",
  toast: "",
};

const categories = ["World Cup", "Crypto", "Politics", "Finance", "Culture", "Technology", "Climate"];

export function App() {
  const [matches, setMatches] = useState<MatchSnapshot[]>([]);
  const [markets, setMarkets] = useState<MarketDefinition[]>(marketCatalog);
  const [allCards, setAllCards] = useState<CardDefinition[]>(cardCatalog);
  const [state, setState] = useState<AppState>(() => loadState());
  const [stake, setStake] = useState(5000);
  const [momentCardId, setMomentCardId] = useState("");
  const [powerCardId, setPowerCardId] = useState("");
  const [historicCardId, setHistoricCardId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeView, setActiveView] = useState<AccountView>("home");
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError("");
      try {
        const [catalog, loadedMatches] = await Promise.all([getCatalog(), getMatches()]);
        if (!active) return;
        setAllCards(catalog.cards);
        setMarkets(catalog.markets);
        setMatches(loadedMatches);
        setState((current) => {
          const preferred = pickLaunchMatch(loadedMatches);
          const currentMatchStillExists = loadedMatches.some((match) => match.id === current.selectedMatchId);
          return {
            ...current,
            selectedMatchId: currentMatchStillExists ? current.selectedMatchId : preferred?.id ?? "",
            selectedMarketId:
              catalog.markets.some((market) => market.id === current.selectedMarketId)
                ? current.selectedMarketId
                : catalog.markets[0]?.id ?? "home-win",
          };
        });
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load real match feed.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === state.selectedMatchId) ?? matches[0],
    [matches, state.selectedMatchId],
  );

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === state.selectedMarketId) ?? markets[0],
    [markets, state.selectedMarketId],
  );

  const marketItems = useMemo<MarketItem[]>(
    () => matches.flatMap((match) => markets.map((market) => ({ match, market }))),
    [matches, markets],
  );

  const selectedCards = useMemo(
    () =>
      [momentCardId, powerCardId, historicCardId]
        .filter(Boolean)
        .map((cardId) => allCards.find((card) => card.id === cardId))
        .filter((card): card is CardDefinition => Boolean(card)),
    [allCards, historicCardId, momentCardId, powerCardId],
  );

  const ownedCounts = useMemo(() => countCards(state.inventory), [state.inventory]);
  const packAvailable = state.connected && state.progress.totalBets >= 10 && state.progress.packsOpened === 0;
  const lockedForMatch = new Set(state.locks[selectedMatch?.id ?? ""] ?? []);
  const openPositions = selectedMatch
    ? state.positions.filter((position) => position.matchId === selectedMatch.id)
    : [];
  const earnedBadges = getEarnedBadges(state, allCards);
  const homeStats = selectedMatch ? teamStats(selectedMatch, selectedMatch.home) : null;
  const awayStats = selectedMatch ? teamStats(selectedMatch, selectedMatch.away) : null;
  const potentialGross = selectedMarket ? Math.floor((stake * selectedMarket.oddsBps) / 10000) : 0;
  const potentialProfit = Math.max(0, potentialGross - stake);
  const maxBonusBps = selectedCards.reduce((sum, card) => sum + card.bonusBps, 0);
  const maxBonus = Math.floor((potentialProfit * maxBonusBps) / 10000);
  const featuredActivity =
    selectedMatch && selectedMarket ? getMarketActivity(state, selectedMatch.id, selectedMarket.id) : emptyActivity();
  const trendingItems = useMemo(() => rankTrendingMarkets(marketItems, state).slice(0, 3), [marketItems, state]);
  const highestVolumeItems = useMemo(() => rankVolumeMarkets(marketItems, state).slice(0, 3), [marketItems, state]);

  function connectWallet() {
    setState((current) => ({ ...current, connected: true }));
    setActiveView("home");
    showToast("Session connected. Account features are available.");
  }

  function disconnectWallet() {
    setState((current) => ({ ...current, connected: false }));
    setActiveView("home");
    setUserMenuOpen(false);
    showToast("Session disconnected.");
  }

  function selectMatch(matchId: string) {
    setState((current) => ({ ...current, selectedMatchId: matchId }));
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
    setActiveView("home");
  }

  function selectMarket(matchId: string, marketId: string) {
    setState((current) => ({ ...current, selectedMatchId: matchId, selectedMarketId: marketId }));
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
    setActiveView("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function placePrediction() {
    if (!state.connected) return showToast("Login before placing predictions.");
    if (!selectedMatch || !selectedMarket) return showToast("Select an available World Cup market.");
    if (stake <= 0) return showToast("Stake must be greater than zero.");
    if (stake > state.progress.balanceCents) return showToast("Insufficient balance.");

    const blockedCard = selectedCards.find((card) => lockedForMatch.has(card.id));
    if (blockedCard) return showToast(`${blockedCard.name} is already locked for this match.`);

    const byType = selectedCards.reduce<Record<CardType, number>>(
      (acc, card) => {
        acc[card.type] += 1;
        return acc;
      },
      { moment: 0, power: 0, historic: 0 },
    );
    if (byType.moment > 1 || byType.power > 1 || byType.historic > 1) {
      return showToast("Use at most one card per card type.");
    }

    const context = {
      team: selectedMatch.home,
      player: selectedMarket.id === "mom-home-team" ? selectedMatch.mom : topRatedPlayer(selectedMatch),
    };
    const position: PositionInput = {
      id: crypto.randomUUID(),
      matchId: selectedMatch.id,
      marketId: selectedMarket.id,
      marketLabel: selectedMarket.label,
      stakeCents: stake,
      oddsBps: selectedMarket.oddsBps,
      context,
      cardIds: selectedCards.map((card) => card.id),
    };

    setState((current) => ({
      ...current,
      progress: {
        ...current.progress,
        balanceCents: current.progress.balanceCents - stake,
        totalBets: current.progress.totalBets + 1,
        matchBetCounts: {
          ...current.progress.matchBetCounts,
          [selectedMatch.id]: (current.progress.matchBetCounts[selectedMatch.id] ?? 0) + 1,
        },
      },
      positions: [...current.positions, position],
      locks: {
        ...current.locks,
        [selectedMatch.id]: [
          ...(current.locks[selectedMatch.id] ?? []),
          ...selectedCards.map((card) => card.id),
        ],
      },
    }));
    showToast("Prediction placed. Cards are locked until this match settles.");
  }

  async function settleMatch() {
    if (!selectedMatch) return;
    if (!openPositions.length) return showToast("No open predictions on this match.");

    const settledPositions = await Promise.all(
      openPositions.map((position) => settlePositionApi(position, selectedMatch)),
    );
    const payout = settledPositions.reduce((sum, position) => sum + position.payoutCents, 0);
    const wonCount = settledPositions.filter((position) => position.won).length;

    setState((current) => {
      const currentStreak = wonCount > 0 ? current.progress.currentStreak + wonCount : 0;
      const riskManagedWins =
        current.progress.riskManagedWins +
        settledPositions.filter((position) => position.won && position.stakeCents <= current.progress.balanceCents * 0.1)
          .length;

      return {
        ...current,
        progress: {
          ...current.progress,
          balanceCents: current.progress.balanceCents + payout,
          currentStreak,
          bestStreak: Math.max(current.progress.bestStreak, currentStreak),
          riskManagedWins,
          oracleSettlements: current.progress.oracleSettlements + settledPositions.length,
        },
        positions: current.positions.filter((position) => position.matchId !== selectedMatch.id),
        settled: [...settledPositions, ...current.settled],
        locks: { ...current.locks, [selectedMatch.id]: [] },
      };
    });

    const bonus = settledPositions.reduce((sum, position) => sum + position.bonusCents, 0);
    showToast(`${wonCount}/${settledPositions.length} settled as wins. Card bonus: ${formatCents(bonus)}.`);
  }

  function openStarterPack() {
    if (!packAvailable) return;
    const awarded = Array.from({ length: 3 }, (_, index) => starterPackPool[index % starterPackPool.length].id);
    setState((current) => ({
      ...current,
      inventory: [...current.inventory, ...awarded],
      progress: { ...current.progress, packsOpened: current.progress.packsOpened + 1 },
    }));
    showToast(`Starter Pack opened: ${awarded.map((id) => allCards.find((card) => card.id === id)?.name).join(", ")}.`);
  }

  function showToast(message: string) {
    setState((current) => ({ ...current, toast: message }));
    window.setTimeout(() => {
      setState((current) => ({ ...current, toast: "" }));
    }, 2600);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-main">
          <button className="brand-lockup" type="button" onClick={() => setActiveView("home")}>
            <img alt="" className="brand-logo" src={predictionLogo} />
            <span>Prediction Arena</span>
          </button>

          <label className="search-box">
            <Search size={20} />
            <input placeholder="Search markets, teams..." type="search" />
          </label>

          {state.connected ? (
            <div className="user-menu-wrap">
              <button
                aria-expanded={userMenuOpen}
                className="user-button"
                type="button"
                onClick={() => setUserMenuOpen((value) => !value)}
              >
                <User size={20} />
                <ChevronDown size={16} />
              </button>
              {userMenuOpen && (
                <div className="user-dropdown">
                  <MenuItem icon={<User />} label="Profile" onClick={() => openAccountView("profile")} />
                  <MenuItem icon={<Gift />} label="Rewards" onClick={() => openAccountView("rewards")} />
                  <MenuItem icon={<Medal />} label="Leaderboard" onClick={() => openAccountView("leaderboard")} />
                  <MenuItem icon={<HelpCircle />} label="Help" onClick={() => openAccountView("help")} />
                  <button className="menu-row danger" type="button" onClick={disconnectWallet}>
                    <LockKeyhole size={17} />
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="auth-actions">
              <button className="login-button" type="button" onClick={connectWallet}>
                Login
              </button>
              <button className="signup-button" type="button" onClick={connectWallet}>
                Sign up
              </button>
            </div>
          )}
        </div>

        <nav className="category-nav" aria-label="Prediction categories">
          {categories.map((category) => (
            <button className={category === "World Cup" ? "is-active" : ""} key={category} type="button">
              {category === "World Cup" && <Trophy size={17} />}
              {category}
            </button>
          ))}
        </nav>
      </header>

      {loadError && <FeedNotice message={loadError} />}

      {activeView === "home" ? (
        <main className="arena-layout">
          <section className="primary-column" aria-label="World Cup markets">
            {selectedMatch && selectedMarket ? (
              <FeaturedMarket
                activity={featuredActivity}
                awayStats={awayStats}
                cards={allCards}
                historicCardId={historicCardId}
                homeStats={homeStats}
                lockedForMatch={lockedForMatch}
                market={selectedMarket}
                match={selectedMatch}
                maxBonus={maxBonus}
                momentCardId={momentCardId}
                ownedInventory={state.inventory}
                potentialGross={potentialGross}
                potentialProfit={potentialProfit}
                powerCardId={powerCardId}
                stake={stake}
                onChangeHistoricCard={setHistoricCardId}
                onChangeMomentCard={setMomentCardId}
                onChangePowerCard={setPowerCardId}
                onChangeStake={setStake}
                onPlacePrediction={placePrediction}
                onSettle={settleMatch}
                onShowToast={showToast}
              />
            ) : (
              <div className="empty-state tall">
                <Clock3 />
                <strong>Waiting for TXLine fixtures</strong>
                <p>Once the backend receives real World Cup data, this market will populate automatically.</p>
              </div>
            )}

            <section className="market-grid-section">
              <SectionTitle
                eyebrow={isLoading ? "Loading fixtures" : `${matches.length} fixtures`}
                title="More World Cup predictions"
              />
              {marketItems.length ? (
                <div className="prediction-grid">
                  {marketItems.map((item) => (
                    <MarketCard
                      activity={getMarketActivity(state, item.match.id, item.market.id)}
                      isSelected={item.match.id === selectedMatch?.id && item.market.id === selectedMarket?.id}
                      item={item}
                      key={`${item.match.id}-${item.market.id}`}
                      onSelect={() => selectMarket(item.match.id, item.market.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <ShieldCheck />
                  <strong>No real fixtures loaded</strong>
                  <p>Configure TXLine credentials on the server. The interface will not invent matches.</p>
                </div>
              )}
            </section>
          </section>

          <aside className="insight-column" aria-label="Match insights">
            {selectedMatch && <LineupPreview match={selectedMatch} />}
            <MarketInsightPanel
              emptyLabel="Activity appears after the first platform position."
              items={trendingItems}
              state={state}
              title="Trending"
              type="trending"
              onSelect={(item) => selectMarket(item.match.id, item.market.id)}
            />
            <MarketInsightPanel
              emptyLabel="Volume appears after users place predictions."
              items={highestVolumeItems}
              state={state}
              title="Highest volume"
              type="volume"
              onSelect={(item) => selectMarket(item.match.id, item.market.id)}
            />
          </aside>
        </main>
      ) : (
        <AccountScreen
          activeView={activeView}
          allCards={allCards}
          earnedBadges={earnedBadges}
          ownedCounts={ownedCounts}
          packAvailable={packAvailable}
          state={state}
          onOpenPack={openStarterPack}
          onSelectView={setActiveView}
          onShowToast={showToast}
        />
      )}

      <div className={`toast ${state.toast ? "is-visible" : ""}`} role="status" aria-live="polite">
        {state.toast}
      </div>
    </div>
  );

  function openAccountView(view: AccountView) {
    setActiveView(view);
    setUserMenuOpen(false);
  }
}

function FeaturedMarket({
  activity,
  awayStats,
  cards,
  historicCardId,
  homeStats,
  lockedForMatch,
  market,
  match,
  maxBonus,
  momentCardId,
  ownedInventory,
  potentialGross,
  potentialProfit,
  powerCardId,
  stake,
  onChangeHistoricCard,
  onChangeMomentCard,
  onChangePowerCard,
  onChangeStake,
  onPlacePrediction,
  onSettle,
  onShowToast,
}: {
  activity: MarketActivity;
  awayStats: ReturnType<typeof teamStats> | null;
  cards: CardDefinition[];
  historicCardId: string;
  homeStats: ReturnType<typeof teamStats> | null;
  lockedForMatch: Set<string>;
  market: MarketDefinition;
  match: MatchSnapshot;
  maxBonus: number;
  momentCardId: string;
  ownedInventory: string[];
  potentialGross: number;
  potentialProfit: number;
  powerCardId: string;
  stake: number;
  onChangeHistoricCard: (value: string) => void;
  onChangeMomentCard: (value: string) => void;
  onChangePowerCard: (value: string) => void;
  onChangeStake: (value: number) => void;
  onPlacePrediction: () => void;
  onSettle: () => void;
  onShowToast: (message: string) => void;
}) {
  const yesPercent = impliedProbability(market.oddsBps);
  const noPercent = 100 - yesPercent;
  const [primaryLabel, secondaryLabel] = outcomeLabels(market, match);

  return (
    <section className="featured-market-card">
      <div className="featured-toolbar">
        <div className="market-type">
          <span className="market-icon">
            <Trophy size={22} />
          </span>
          <div>
            <span>Football</span>
            <strong>{match.competition ?? "World Cup"}</strong>
          </div>
        </div>
        <div className="icon-actions">
          <button aria-label="Copy market link" type="button">
            <Link2 size={18} />
          </button>
          <button aria-label="Save market" type="button">
            <Bookmark size={18} />
          </button>
        </div>
      </div>

      <div className="featured-content">
        <div className="featured-copy">
          <div className="market-status-row">
            <span>{match.status}</span>
            <span>{formatStart(match.startTime)}</span>
            <span>{formatCents(activity.volumeCents)} vol</span>
          </div>
          <h1>{marketQuestion(market, match)}</h1>

          <div className="outcome-stack">
            <OutcomeRow label={primaryLabel} logoUrl={match.homeLogoUrl} percent={yesPercent} teamCode={match.homeCode} />
            <OutcomeRow
              label={secondaryLabel}
              logoUrl={match.awayLogoUrl}
              percent={noPercent}
              teamCode={match.awayCode}
              tone="secondary"
            />
          </div>

          <div className="market-meta-grid">
            <Metric icon={<Users />} label="Positions" value={String(activity.positions)} />
            <Metric icon={<CircleDollarSign />} label="Volume" value={formatCents(activity.volumeCents)} />
            <Metric icon={<BarChart3 />} label="Source" value={match.source.toUpperCase()} />
          </div>
        </div>

        <PositionShareChart
          activity={activity}
          noLabel={secondaryLabel}
          noPercent={noPercent}
          yesLabel={primaryLabel}
          yesPercent={yesPercent}
        />
      </div>

      <div className="trade-panel">
        <div className="trade-inputs">
          <label className="field">
            <span>Stake</span>
            <input
              min={10}
              step={10}
              type="number"
              value={stake / 100}
              onChange={(event) => onChangeStake(Math.max(0, Math.round(Number(event.target.value) * 100)))}
            />
          </label>
          <div className="ticket-metrics">
            <Metric label="Gross payout" value={formatCents(potentialGross)} />
            <Metric label="Net profit" value={formatCents(potentialProfit)} />
            <Metric label="Max card bonus" value={formatCents(maxBonus)} />
          </div>
        </div>

        <div className="boost-selectors">
          <CardSelect
            cards={cards}
            inventory={ownedInventory}
            label="Moment"
            locked={lockedForMatch}
            type="moment"
            value={momentCardId}
            onChange={onChangeMomentCard}
          />
          <CardSelect
            cards={cards}
            inventory={ownedInventory}
            label="Power"
            locked={lockedForMatch}
            type="power"
            value={powerCardId}
            onChange={onChangePowerCard}
          />
          <CardSelect
            cards={cards}
            inventory={ownedInventory}
            label="Historic"
            locked={lockedForMatch}
            type="historic"
            value={historicCardId}
            onChange={onChangeHistoricCard}
          />
        </div>

        <div className="trade-actions">
          <button className="yes-button" type="button" onClick={onPlacePrediction}>
            Yes {formatProbability(market.oddsBps)}
          </button>
          <button className="no-button" type="button" onClick={() => onShowToast("No-side settlement will be wired next.")}>
            No {formatNoProbability(market.oddsBps)}
          </button>
          <button className="settle-button" type="button" onClick={onSettle}>
            <ShieldCheck size={17} />
            Settle
          </button>
        </div>
      </div>

      <div className="market-stat-band">
        <StatComparison
          label="Possession"
          left={homeStats ? `${homeStats.possession}%` : "N/A"}
          right={awayStats ? `${awayStats.possession}%` : "N/A"}
        />
        <StatComparison
          label="Shots faced"
          left={homeStats ? String(homeStats.shotsAgainst) : "N/A"}
          right={awayStats ? String(awayStats.shotsAgainst) : "N/A"}
        />
        <StatComparison
          label="Corners faced"
          left={homeStats ? String(homeStats.cornersAgainst) : "N/A"}
          right={awayStats ? String(awayStats.cornersAgainst) : "N/A"}
        />
      </div>
    </section>
  );
}

function PositionShareChart({
  activity,
  noLabel,
  noPercent,
  yesLabel,
  yesPercent,
}: {
  activity: MarketActivity;
  noLabel: string;
  noPercent: number;
  yesLabel: string;
  yesPercent: number;
}) {
  return (
    <div className="position-chart-card">
      <div className="chart-heading">
        <div>
          <span>Position split</span>
          <strong>{Math.round(yesPercent)}%</strong>
        </div>
        <small>{activity.positions ? `${activity.positions} platform positions` : "No positions yet"}</small>
      </div>
      <div className="position-bars" aria-label="Current position split">
        <div className="position-bar yes" style={{ width: `${yesPercent}%` }} />
        <div className="position-bar no" style={{ width: `${noPercent}%` }} />
      </div>
      <div className="chart-grid">
        {[0, 25, 50, 75, 100].map((tick) => (
          <span key={tick}>{tick}%</span>
        ))}
      </div>
      <div className="legend-row">
        <span>
          <i className="dot yes" />
          {yesLabel}
        </span>
        <strong>{yesPercent.toFixed(1)}%</strong>
      </div>
      <div className="legend-row">
        <span>
          <i className="dot no" />
          {noLabel}
        </span>
        <strong>{noPercent.toFixed(1)}%</strong>
      </div>
    </div>
  );
}

function OutcomeRow({
  label,
  logoUrl,
  percent,
  teamCode,
  tone = "primary",
}: {
  label: string;
  logoUrl?: string;
  percent: number;
  teamCode: string;
  tone?: "primary" | "secondary";
}) {
  return (
    <div className={`outcome-row ${tone}`}>
      <TeamAvatar code={teamCode} logoUrl={logoUrl} />
      <strong>{label}</strong>
      <span>{Math.round(percent)}%</span>
    </div>
  );
}

function MarketCard({
  activity,
  isSelected,
  item,
  onSelect,
}: {
  activity: MarketActivity;
  isSelected: boolean;
  item: MarketItem;
  onSelect: () => void;
}) {
  const yesPercent = impliedProbability(item.market.oddsBps);
  const noPercent = 100 - yesPercent;

  return (
    <button className={`prediction-card ${isSelected ? "is-selected" : ""}`} type="button" onClick={onSelect}>
      <div className="card-title-row">
        <TeamAvatar code={item.match.homeCode} logoUrl={item.match.homeLogoUrl} />
        <div>
          <span>{item.match.competition ?? "World Cup"}</span>
          <strong>{marketQuestion(item.market, item.match)}</strong>
        </div>
      </div>
      <div className="mini-outcomes">
        <div>
          <span>Yes</span>
          <strong>{Math.round(yesPercent)}%</strong>
          <em>Yes</em>
        </div>
        <div>
          <span>No</span>
          <strong>{Math.round(noPercent)}%</strong>
          <em>No</em>
        </div>
      </div>
      <div className="card-footer">
        <span>{formatCents(activity.volumeCents)} vol.</span>
        <div>
          <Gift size={16} />
          <Bookmark size={16} />
        </div>
      </div>
    </button>
  );
}

function LineupPreview({ match }: { match: MatchSnapshot }) {
  const homeLineup = match.lineups?.[match.home];
  const awayLineup = match.lineups?.[match.away];
  const hasLineups = Boolean(homeLineup?.starters.length || awayLineup?.starters.length);
  const title = match.status === "SCHEDULED" ? "Expected lineups" : "Confirmed lineups";

  return (
    <section className="lineup-panel">
      <div className="lineup-top">
        <TeamCompact code={match.homeCode} logoUrl={match.homeLogoUrl} name={match.home} />
        <TeamCompact alignRight code={match.awayCode} logoUrl={match.awayLogoUrl} name={match.away} />
      </div>
      <div className="lineup-subhead">
        <span>{title}</span>
        <strong>{formatStart(match.startTime)}</strong>
      </div>
      <div className={`pitch-surface ${hasLineups ? "has-lineups" : "is-empty"}`}>
        {hasLineups ? (
          <>
            <LineupSide lineup={homeLineup} side="home" />
            <LineupSide lineup={awayLineup} side="away" />
          </>
        ) : (
          <div className="lineup-empty">
            <BarChart3 />
            <strong>Lineups feed pending</strong>
            <p>Probable and confirmed XIs will appear here once a lineup provider is mapped to this fixture.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function MarketInsightPanel({
  emptyLabel,
  items,
  state,
  title,
  type,
  onSelect,
}: {
  emptyLabel: string;
  items: MarketItem[];
  state: AppState;
  title: string;
  type: "trending" | "volume";
  onSelect: (item: MarketItem) => void;
}) {
  const hasActivity = items.some((item) => getMarketActivity(state, item.match.id, item.market.id).positions > 0);

  return (
    <section className="insight-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {type === "trending" ? <TrendingUp size={20} /> : <CircleDollarSign size={20} />}
      </div>
      {!hasActivity && <p className="panel-note">{emptyLabel}</p>}
      <div className="insight-list">
        {items.map((item) => {
          const activity = getMarketActivity(state, item.match.id, item.market.id);
          const probability = impliedProbability(item.market.oddsBps);
          return (
            <button className="insight-row" key={`${title}-${item.match.id}-${item.market.id}`} type="button" onClick={() => onSelect(item)}>
              <div>
                <strong>{marketQuestion(item.market, item.match)}</strong>
                <span>
                  {item.match.home} vs {item.match.away}
                </span>
                <small>{type === "volume" ? `${formatCents(activity.volumeCents)} vol` : `${activity.positions} positions`}</small>
              </div>
              <em>{Math.round(probability)}%</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AccountScreen({
  activeView,
  allCards,
  earnedBadges,
  ownedCounts,
  packAvailable,
  state,
  onOpenPack,
  onSelectView,
  onShowToast,
}: {
  activeView: AccountView;
  allCards: CardDefinition[];
  earnedBadges: ReturnType<typeof getEarnedBadges>;
  ownedCounts: Record<string, number>;
  packAvailable: boolean;
  state: AppState;
  onOpenPack: () => void;
  onSelectView: (view: AccountView) => void;
  onShowToast: (message: string) => void;
}) {
  const stats = getAccountStats(state);

  return (
    <main className="account-layout">
      <aside className="account-nav">
        <button className={activeView === "profile" ? "is-active" : ""} type="button" onClick={() => onSelectView("profile")}>
          <User size={18} />
          Profile
        </button>
        <button className={activeView === "rewards" ? "is-active" : ""} type="button" onClick={() => onSelectView("rewards")}>
          <Gift size={18} />
          Rewards
        </button>
        <button className={activeView === "leaderboard" ? "is-active" : ""} type="button" onClick={() => onSelectView("leaderboard")}>
          <Medal size={18} />
          Leaderboard
        </button>
        <button className={activeView === "help" ? "is-active" : ""} type="button" onClick={() => onSelectView("help")}>
          <HelpCircle size={18} />
          Help
        </button>
      </aside>

      <section className="account-content">
        {activeView === "profile" && (
          <div className="account-card">
            <SectionTitle eyebrow="Account" title="Profile" />
            <div className="profile-grid">
              <label className="field">
                <span>Display name</span>
                <input defaultValue="Prediction Arena Player" />
              </label>
              <label className="field">
                <span>Wallet</span>
                <input readOnly value="0x7A...91F" />
              </label>
              <label className="field wide">
                <span>Bio</span>
                <textarea defaultValue="World Cup markets, cards and match-day predictions." />
              </label>
            </div>
            <button className="signup-button account-action" type="button" onClick={() => onShowToast("Profile saved locally for this session.")}>
              Save profile
            </button>
          </div>
        )}

        {activeView === "rewards" && (
          <div className="account-stack">
            <div className="balance-hero">
              <div>
                <span>Available balance</span>
                <strong>{formatCents(state.progress.balanceCents)}</strong>
              </div>
              <button className="signup-button" disabled={!packAvailable} type="button" onClick={onOpenPack}>
                <PackageOpen size={18} />
                Open starter pack
              </button>
            </div>

            <div className="account-grid two">
              <div className="account-card">
                <SectionTitle eyebrow="History" title="Prediction results" />
                <RewardHistory positions={state.positions} settled={state.settled} />
              </div>
              <div className="account-card">
                <SectionTitle eyebrow="NFT layer" title="Cards and badges" />
                <CardShelf cards={allCards} ownedCounts={ownedCounts} />
                <BadgeShelf badges={earnedBadges} />
              </div>
            </div>
          </div>
        )}

        {activeView === "leaderboard" && (
          <div className="account-stack">
            <SectionTitle eyebrow="Classification" title="Leaderboard" />
            <div className="leaderboard-grid">
              <LeaderboardTable label="Most predictions" metric={`${state.progress.totalBets}`} stats={stats} />
              <LeaderboardTable label="Total value won" metric={formatCents(stats.totalWonCents)} stats={stats} />
              <LeaderboardTable label="Correct predictions" metric={`${stats.correctPredictions}`} stats={stats} />
            </div>
          </div>
        )}

        {activeView === "help" && (
          <div className="account-card">
            <SectionTitle eyebrow="Support" title="Help" />
            <div className="help-grid">
              <div>
                <LifeBuoy size={24} />
                <strong>Report a problem</strong>
                <p>Send fixture, settlement or card issues to the platform team.</p>
              </div>
              <label className="field wide">
                <span>Message</span>
                <textarea placeholder="Describe what happened..." />
              </label>
            </div>
            <button className="signup-button account-action" type="button" onClick={() => onShowToast("Support request saved locally for the demo.")}>
              Send request
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="menu-row" type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function TeamCompact({
  alignRight,
  code,
  logoUrl,
  name,
}: {
  alignRight?: boolean;
  code: string;
  logoUrl?: string;
  name: string;
}) {
  return (
    <div className={`team-compact ${alignRight ? "align-right" : ""}`}>
      <TeamAvatar code={code} logoUrl={logoUrl} />
      <strong>{name}</strong>
    </div>
  );
}

function TeamAvatar({ code, logoUrl }: { code: string; logoUrl?: string }) {
  return logoUrl ? (
    <img alt="" className="team-avatar" src={logoUrl} />
  ) : (
    <span className="team-avatar fallback">{code.slice(0, 3)}</span>
  );
}

function LineupSide({ lineup, side }: { lineup?: TeamLineup; side: "home" | "away" }) {
  if (!lineup) return null;
  return (
    <div className={`lineup-side ${side}`}>
      <span className="formation-label">{lineup.formation ?? "XI"}</span>
      {lineup.starters.map((player, index) => (
        <div
          className="player-chip"
          key={player.id ?? `${player.name}-${index}`}
          style={{
            left: `${player.x ?? lineupX(index, side)}%`,
            top: `${player.y ?? lineupY(index)}%`,
          }}
        >
          {player.number && <span>{player.number}</span>}
          <strong>{player.name}</strong>
        </div>
      ))}
    </div>
  );
}

function StatComparison({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <div className="stat-comparison">
      <strong>{left}</strong>
      <span>{label}</span>
      <strong>{right}</strong>
    </div>
  );
}

function CardSelect({
  cards,
  inventory,
  label,
  locked,
  onChange,
  type,
  value,
}: {
  cards: CardDefinition[];
  inventory: string[];
  label: string;
  locked: Set<string>;
  onChange: (value: string) => void;
  type: CardType;
  value: string;
}) {
  const owned = cards.filter((card) => card.type === type && inventory.includes(card.id));

  return (
    <label className="field compact-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">No card</option>
        {owned.map((card) => (
          <option disabled={locked.has(card.id)} key={card.id} value={card.id}>
            {card.name} - {formatBps(card.bonusBps)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CardShelf({ cards, ownedCounts }: { cards: CardDefinition[]; ownedCounts: Record<string, number> }) {
  const ownedCards = cards.filter((card) => ownedCounts[card.id]);
  if (!ownedCards.length) {
    return (
      <div className="empty-state compact">
        <PackageOpen />
        <strong>No cards yet</strong>
        <p>Place 10 predictions to unlock the starter pack.</p>
      </div>
    );
  }
  return (
    <div className="card-shelf">
      {ownedCards.map((card) => (
        <article className={`nft-card ${card.rarity}`} key={card.id}>
          <div className="card-topline">
            <span>{card.type}</span>
            <strong>{formatBps(card.bonusBps)}</strong>
          </div>
          <h3>{card.name}</h3>
          <p>{card.condition}</p>
          <small>
            {card.rarity} x{ownedCounts[card.id]}
          </small>
        </article>
      ))}
    </div>
  );
}

function BadgeShelf({ badges }: { badges: ReturnType<typeof getEarnedBadges> }) {
  return (
    <div className="badge-shelf">
      {skillBadges.slice(0, 5).map((badge) => (
        <div className={`badge-item ${badges.includes(badge) ? "is-earned" : ""}`} key={badge.id}>
          <BadgeCheck size={18} />
          <div>
            <strong>{badge.name}</strong>
            <small>{badge.condition}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function RewardHistory({ positions, settled }: { positions: PositionInput[]; settled: SettledPosition[] }) {
  const rows = [
    ...positions.map((position) => ({ ...position, status: "Open", amount: -position.stakeCents })),
    ...settled.map((position) => ({
      ...position,
      status: position.won ? "Won" : "Lost",
      amount: position.won ? position.netProfitCents + position.bonusCents : -position.stakeCents,
    })),
  ];

  if (!rows.length) return <div className="event-empty">No prediction history yet.</div>;

  return (
    <div className="history-list">
      {rows.slice(0, 8).map((row) => (
        <div className="history-row" key={row.id}>
          <History size={17} />
          <div>
            <strong>{row.marketLabel}</strong>
            <span>{row.status}</span>
          </div>
          <em className={row.amount >= 0 ? "is-positive" : "is-negative"}>{formatSignedCents(row.amount)}</em>
        </div>
      ))}
    </div>
  );
}

function LeaderboardTable({ label, metric, stats }: { label: string; metric: string; stats: ReturnType<typeof getAccountStats> }) {
  return (
    <div className="account-card leaderboard-card">
      <h3>{label}</h3>
      <div className="leaderboard-row">
        <span>1</span>
        <User size={18} />
        <strong>You</strong>
        <em>{metric}</em>
      </div>
      <small>
        Demo stats: {stats.correctPredictions} correct, {formatCents(stats.totalWonCents)} won.
      </small>
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FeedNotice({ message }: { message: string }) {
  return (
    <div className="feed-notice">
      <ShieldCheck size={18} />
      <span>{message}. Check TXLine guest JWT/API token and restart the FastAPI service.</span>
    </div>
  );
}

function getEarnedBadges(state: AppState, allCards: CardDefinition[]) {
  return skillBadges.filter((badge) => {
    if (badge.id === "starter-scout") return state.progress.packsOpened > 0;
    if (badge.id === "pack-runner") return state.progress.totalBets >= 10;
    if (badge.id === "sharp-scout") return state.progress.bestStreak >= 3;
    if (badge.id === "live-trader") return Object.values(state.progress.matchBetCounts).some((count) => count >= 3);
    if (badge.id === "risk-manager") return state.progress.riskManagedWins > 0;
    if (badge.id === "oracle-believer") return state.progress.oracleSettlements > 0;
    if (badge.id === "legend-caller") {
      return state.settled.some((position) =>
        position.activatedCardIds.some((cardId) => allCards.find((card) => card.id === cardId)?.rarity === "legendary"),
      );
    }
    return false;
  });
}

function countCards(inventory: string[]): Record<string, number> {
  return inventory.reduce<Record<string, number>>((acc, cardId) => {
    acc[cardId] = (acc[cardId] ?? 0) + 1;
    return acc;
  }, {});
}

function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialState;
    return { ...initialState, ...JSON.parse(saved) } as AppState;
  } catch {
    return initialState;
  }
}

function pickLaunchMatch(matches: MatchSnapshot[]): MatchSnapshot | undefined {
  return (
    matches.find((match) => match.home === "Spain" && match.away === "Argentina") ??
    matches.find((match) => match.home === "Argentina" && match.away === "Spain") ??
    matches[0]
  );
}

function rankTrendingMarkets(items: MarketItem[], state: AppState): MarketItem[] {
  const ranked = [...items].sort((a, b) => {
    const activityA = getMarketActivity(state, a.match.id, a.market.id);
    const activityB = getMarketActivity(state, b.match.id, b.market.id);
    return activityB.positions - activityA.positions || impliedProbability(b.market.oddsBps) - impliedProbability(a.market.oddsBps);
  });
  return ranked;
}

function rankVolumeMarkets(items: MarketItem[], state: AppState): MarketItem[] {
  const ranked = [...items].sort((a, b) => {
    const activityA = getMarketActivity(state, a.match.id, a.market.id);
    const activityB = getMarketActivity(state, b.match.id, b.market.id);
    return activityB.volumeCents - activityA.volumeCents || impliedProbability(b.market.oddsBps) - impliedProbability(a.market.oddsBps);
  });
  return ranked;
}

function getMarketActivity(state: AppState, matchId: string, marketId: string): MarketActivity {
  const open = state.positions.filter((position) => position.matchId === matchId && position.marketId === marketId);
  const settled = state.settled.filter((position) => position.matchId === matchId && position.marketId === marketId);
  const positions = open.length + settled.length;
  return {
    volumeCents: [...open, ...settled].reduce((sum, position) => sum + position.stakeCents, 0),
    positions,
    bettors: positions > 0 && state.connected ? 1 : 0,
    wonCents: settled.reduce((sum, position) => sum + (position.won ? position.netProfitCents + position.bonusCents : 0), 0),
  };
}

function emptyActivity(): MarketActivity {
  return { bettors: 0, positions: 0, volumeCents: 0, wonCents: 0 };
}

function getAccountStats(state: AppState) {
  return {
    correctPredictions: state.settled.filter((position) => position.won).length,
    totalLostCents: state.settled.filter((position) => !position.won).reduce((sum, position) => sum + position.stakeCents, 0),
    totalWonCents: state.settled.reduce(
      (sum, position) => sum + (position.won ? position.netProfitCents + position.bonusCents : 0),
      0,
    ),
  };
}

function lineupX(index: number, side: "home" | "away"): number {
  const lanes = side === "home" ? [9, 22, 36, 47] : [91, 78, 64, 53];
  return lanes[index % lanes.length];
}

function lineupY(index: number): number {
  return [50, 24, 76, 38, 62, 14, 86, 30, 70, 45, 55][index % 11];
}

function outcomeLabels(market: MarketDefinition, match: MatchSnapshot): [string, string] {
  if (market.id === "home-win") return [match.home, match.away];
  if (market.id === "away-win") return [match.away, match.home];
  return ["Yes", "No"];
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    currency: "USD",
    style: "currency",
  });
}

function formatSignedCents(cents: number): string {
  const absolute = formatCents(Math.abs(cents));
  if (cents > 0) return `+${absolute}`;
  if (cents < 0) return `-${absolute}`;
  return absolute;
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function impliedProbability(oddsBps: number): number {
  if (!oddsBps) return 0;
  return Math.max(1, Math.min(99, (10000 / oddsBps) * 100));
}

function formatProbability(oddsBps: number): string {
  if (!oddsBps) return "--";
  return `${Math.round(impliedProbability(oddsBps))}c`;
}

function formatNoProbability(oddsBps: number): string {
  if (!oddsBps) return "--";
  return `${Math.max(1, 100 - Math.round(impliedProbability(oddsBps)))}c`;
}

function marketQuestion(market: MarketDefinition, match: MatchSnapshot): string {
  switch (market.id) {
    case "home-win":
      return `Will ${match.home} beat ${match.away}?`;
    case "away-win":
      return `Will ${match.away} beat ${match.home}?`;
    case "home-goal":
      return `Will ${match.home} score?`;
    case "home-clean-sheet":
      return `Will ${match.home} keep a clean sheet?`;
    case "hat-trick-market":
      return `Will any player score a hat-trick?`;
    case "mom-home-team":
      return `Will the match MVP come from ${match.home}?`;
    default:
      return market.label;
  }
}

function formatStart(value?: string | number): string {
  if (!value) return "Time TBA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

import {
  BadgeCheck,
  BarChart3,
  CircleDollarSign,
  Clock3,
  Layers3,
  LockKeyhole,
  PackageOpen,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cards as cardCatalog, starterPackPool } from "../shared/cards";
import { skillBadges } from "../shared/badges";
import { markets as marketCatalog } from "../shared/demo-data";
import { teamStats, topRatedPlayer } from "../shared/settlement";
import type {
  CardDefinition,
  CardType,
  MarketDefinition,
  MatchEvent,
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
        setState((current) => ({
          ...current,
          selectedMatchId: current.selectedMatchId || loadedMatches[0]?.id || "",
        }));
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

  function connectWallet() {
    setState((current) => ({ ...current, connected: !current.connected }));
    showToast(state.connected ? "Wallet disconnected." : "Wallet connected for this hackathon session.");
  }

  function selectMatch(matchId: string) {
    setState((current) => ({ ...current, selectedMatchId: matchId }));
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
  }

  function placePrediction() {
    if (!state.connected) return showToast("Connect a wallet before placing predictions.");
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
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">PPA</span>
          <div>
            <p className="eyebrow">World Cup prediction market</p>
            <h1>Player Prediction Arena</h1>
          </div>
        </div>
        <div className="top-actions">
          <Metric label="Feed" value={selectedMatch?.source === "txline" ? "TXLine" : selectedMatch?.source ?? "Waiting"} />
          {state.connected && <Metric label="Balance" value={formatCents(state.progress.balanceCents)} />}
          <button className="primary-button" type="button" onClick={connectWallet}>
            <Wallet size={18} />
            {state.connected ? "0x7A...91F" : "Connect Wallet"}
          </button>
        </div>
      </header>

      {loadError && <FeedNotice message={loadError} />}

      <main className="home-grid">
        <section className="market-board" aria-label="World Cup markets">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Markets</p>
              <h2>World Cup board</h2>
            </div>
            <span className="count-pill">{isLoading ? "Loading" : `${matches.length} fixtures`}</span>
          </div>

          <div className="match-list">
            {matches.map((match) => (
              <button
                className={`match-row ${match.id === selectedMatch?.id ? "is-selected" : ""}`}
                key={match.id}
                type="button"
                onClick={() => selectMatch(match.id)}
              >
                <TeamIdentity code={match.homeCode} logoUrl={match.homeLogoUrl} name={match.home} />
                <div className="match-score">
                  <strong>
                    {match.score[match.home] ?? 0} - {match.score[match.away] ?? 0}
                  </strong>
                  <span>{match.status === "SCHEDULED" ? formatStart(match.startTime) : match.minute}</span>
                </div>
                <TeamIdentity alignRight code={match.awayCode} logoUrl={match.awayLogoUrl} name={match.away} />
              </button>
            ))}
            {!matches.length && (
              <div className="empty-state">
                <ShieldCheck />
                <strong>No real fixtures loaded</strong>
                <p>Configure TXLine credentials on the server. The interface will not invent matches when the feed is unavailable.</p>
              </div>
            )}
          </div>

          {selectedMatch && (
            <div className="prediction-list">
              {markets.map((market) => (
                <button
                  className={`prediction-row ${market.id === selectedMarket?.id ? "is-selected" : ""}`}
                  key={market.id}
                  type="button"
                  onClick={() => setState((current) => ({ ...current, selectedMarketId: market.id }))}
                >
                  <div>
                    <span>{market.kind}</span>
                    <strong>{market.label}</strong>
                  </div>
                  <div className="price-pair">
                    <span>Yes {formatProbability(market.oddsBps)}</span>
                    <strong>{formatDecimal(market.oddsBps)}x</strong>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="match-center" aria-label="Match center">
          {selectedMatch ? (
            <>
              <div className="match-hero">
                <div>
                  <p className="eyebrow">{selectedMatch.competition ?? "World Cup"}</p>
                  <h2>
                    {selectedMatch.home} vs {selectedMatch.away}
                  </h2>
                  <p className="muted">
                    {selectedMatch.round ?? "Confirmed fixture"} - {selectedMatch.status} - {formatStart(selectedMatch.startTime)}
                  </p>
                </div>
                <div className="score-chip">
                  <strong>
                    {selectedMatch.score[selectedMatch.home] ?? 0}:{selectedMatch.score[selectedMatch.away] ?? 0}
                  </strong>
                  <span>{selectedMatch.minute}</span>
                </div>
              </div>

              <LineupPitch match={selectedMatch} />

              <div className="stats-strip">
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

              <div className="event-panel">
                <div className="section-heading compact">
                  <h3>Timeline</h3>
                  <span className="source-pill">{selectedMatch.source}</span>
                </div>
                <EventList events={selectedMatch.events} />
              </div>
            </>
          ) : (
            <div className="empty-state tall">
              <Clock3 />
              <strong>Waiting for TXLine fixtures</strong>
              <p>Once the backend receives real World Cup data, the match center will populate automatically.</p>
            </div>
          )}
        </section>

        <aside className="trade-rail" aria-label="Trade ticket and wallet">
          <section className="trade-ticket">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Trade ticket</p>
                <h2>{selectedMarket?.label ?? "Select a market"}</h2>
              </div>
              <Sparkles size={20} />
            </div>

            <label className="field">
              <span>Stake</span>
              <input
                min={10}
                step={10}
                type="number"
                value={stake / 100}
                onChange={(event) => setStake(Math.max(0, Math.round(Number(event.target.value) * 100)))}
              />
            </label>

            <div className="ticket-metrics">
              <Metric label="Gross payout" value={formatCents(potentialGross)} />
              <Metric label="Net profit" value={formatCents(potentialProfit)} />
              <Metric label="Max card bonus" value={formatCents(maxBonus)} />
            </div>

            <div className="loadout-stack">
              <CardSelect
                cards={allCards}
                inventory={state.inventory}
                label="Moment Card"
                locked={lockedForMatch}
                type="moment"
                value={momentCardId}
                onChange={setMomentCardId}
              />
              <CardSelect
                cards={allCards}
                inventory={state.inventory}
                label="Power Card"
                locked={lockedForMatch}
                type="power"
                value={powerCardId}
                onChange={setPowerCardId}
              />
              <CardSelect
                cards={allCards}
                inventory={state.inventory}
                label="Historic Squad Card"
                locked={lockedForMatch}
                type="historic"
                value={historicCardId}
                onChange={setHistoricCardId}
              />
            </div>

            <button className="primary-button full-width" type="button" onClick={placePrediction}>
              <Zap size={18} />
              Place Prediction
            </button>
          </section>

          <section className="wallet-panel">
            <div className="section-heading compact">
              <h3>Wallet state</h3>
              {state.connected ? <BadgeCheck size={20} /> : <LockKeyhole size={20} />}
            </div>

            {state.connected ? (
              <>
                <div className="wallet-metrics">
                  <Metric icon={<CircleDollarSign />} label="Balance" value={formatCents(state.progress.balanceCents)} />
                  <Metric icon={<Layers3 />} label="Predictions" value={`${state.progress.totalBets}/10`} />
                  <Metric icon={<Trophy />} label="Best streak" value={String(state.progress.bestStreak)} />
                </div>

                <div className="pack-panel">
                  <div>
                    <p className="eyebrow">Starter pack</p>
                    <strong>3 basic cards after 10 predictions</strong>
                  </div>
                  <button className="secondary-button" type="button" disabled={!packAvailable} onClick={openStarterPack}>
                    <PackageOpen size={18} />
                    Open
                  </button>
                </div>

                <CardShelf cards={allCards} ownedCounts={ownedCounts} />
              </>
            ) : (
              <div className="empty-state">
                <Wallet />
                <strong>Connect to reveal cards</strong>
                <p>Cards stay off-chain for this first release, but every card instance is tied to the prediction rules.</p>
              </div>
            )}
          </section>

          <section className="positions-panel">
            <div className="section-heading compact">
              <h3>Open predictions</h3>
              <button className="secondary-button small" type="button" onClick={settleMatch}>
                <ShieldCheck size={16} />
                Settle
              </button>
            </div>
            <PositionList positions={openPositions} />
          </section>

          <section className="badges-panel">
            <div className="section-heading compact">
              <h3>Skill Badges</h3>
              <span className="count-pill">
                {earnedBadges.length}/{skillBadges.length}
              </span>
            </div>
            <div className="badge-list">
              {skillBadges.slice(0, 4).map((badge) => (
                <div className={`badge-item ${earnedBadges.includes(badge) ? "is-earned" : ""}`} key={badge.id}>
                  <BadgeCheck size={18} />
                  <div>
                    <strong>{badge.name}</strong>
                    <small>{badge.condition}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <div className={`toast ${state.toast ? "is-visible" : ""}`} role="status" aria-live="polite">
        {state.toast}
      </div>
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

function TeamIdentity({
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
    <div className={`team-identity ${alignRight ? "align-right" : ""}`}>
      <TeamAvatar code={code} logoUrl={logoUrl} />
      <div>
        <strong>{name}</strong>
        <span>{code}</span>
      </div>
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

function LineupPitch({ match }: { match: MatchSnapshot }) {
  const homeLineup = match.lineups?.[match.home];
  const awayLineup = match.lineups?.[match.away];
  const hasLineups = Boolean(homeLineup?.starters.length || awayLineup?.starters.length);

  return (
    <div className="lineup-card">
      <div className="lineup-header">
        <TeamIdentity code={match.homeCode} logoUrl={match.homeLogoUrl} name={match.home} />
        <span>Lineups</span>
        <TeamIdentity alignRight code={match.awayCode} logoUrl={match.awayLogoUrl} name={match.away} />
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
            <strong>Lineups unavailable from connected feeds</strong>
            <p>TXLine covers fixtures, scores and odds. Starting XI data needs a mapped lineup provider before we show players here.</p>
          </div>
        )}
      </div>
    </div>
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

function EventList({ events }: { events: MatchEvent[] }) {
  if (!events.length) {
    return <div className="event-empty">No event timeline in the connected feed yet.</div>;
  }
  return (
    <div className="event-list">
      {events.slice(-6).map((event, index) => (
        <div className="event-row" key={`${event.minute}-${event.player}-${index}`}>
          <span>{event.minute}'</span>
          <strong>{event.player}</strong>
          <small>
            {event.team} - {event.type}
          </small>
        </div>
      ))}
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
    <label className="field">
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
          <h4>{card.name}</h4>
          <p>{card.condition}</p>
          <small>
            {card.rarity} x{ownedCounts[card.id]}
          </small>
        </article>
      ))}
    </div>
  );
}

function PositionList({ positions }: { positions: PositionInput[] }) {
  if (!positions.length) return <div className="event-empty">No open predictions on this match.</div>;
  return (
    <div className="position-list">
      {positions.map((position) => (
        <div className="position-row" key={position.id}>
          <div>
            <strong>{position.marketLabel}</strong>
            <span>{position.cardIds.length ? position.cardIds.join(", ") : "No card boost"}</span>
          </div>
          <small>{formatCents(position.stakeCents)}</small>
        </div>
      ))}
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

function lineupX(index: number, side: "home" | "away"): number {
  const lanes = side === "home" ? [9, 22, 36, 47] : [91, 78, 64, 53];
  return lanes[index % lanes.length];
}

function lineupY(index: number): number {
  return [50, 24, 76, 38, 62, 14, 86, 30, 70, 45, 55][index % 11];
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    currency: "USD",
    style: "currency",
  });
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatDecimal(oddsBps: number): string {
  return (oddsBps / 10000).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatProbability(oddsBps: number): string {
  if (!oddsBps) return "--";
  const cents = Math.round((10000 / oddsBps) * 100);
  return `${Math.max(1, Math.min(99, cents))}c`;
}

function formatStart(value?: string): string {
  if (!value) return "Time TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

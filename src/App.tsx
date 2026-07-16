import {
  BadgeCheck,
  CircleDollarSign,
  Layers3,
  PackageOpen,
  RotateCcw,
  ShieldCheck,
  Trophy,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cards as cardCatalog, starterPackPool } from "../shared/cards";
import { skillBadges } from "../shared/badges";
import { markets as marketCatalog } from "../shared/demo-data";
import {
  teamStats,
  topRatedPlayer,
} from "../shared/settlement";
import type {
  CardDefinition,
  CardType,
  MarketDefinition,
  MatchSnapshot,
  PositionInput,
  SettledPosition,
  UserProgress,
} from "../shared/types";
import { getCatalog, getMatches, settlePositionApi } from "./services/api";

type Filter = "all" | CardType;

interface AppState {
  progress: UserProgress;
  inventory: string[];
  positions: PositionInput[];
  settled: SettledPosition[];
  locks: Record<string, string[]>;
  selectedMatchId: string;
  selectedMarketId: string;
  selectedFilter: Filter;
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
  progress: initialProgress,
  inventory: [],
  positions: [],
  settled: [],
  locks: {},
  selectedMatchId: "bra-arg",
  selectedMarketId: "home-win",
  selectedFilter: "all",
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

  useEffect(() => {
    let active = true;

    Promise.all([getCatalog(), getMatches()]).then(([catalog, loadedMatches]) => {
      if (!active) return;
      setAllCards(catalog.cards);
      setMarkets(catalog.markets);
      setMatches(loadedMatches);
      setState((current) => ({
        ...current,
        selectedMatchId: loadedMatches[0]?.id ?? current.selectedMatchId,
      }));
    });

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

  const packAvailable = state.progress.totalBets >= 10 && state.progress.packsOpened === 0;
  const ownedCounts = countCards(state.inventory);
  const lockedForMatch = new Set(state.locks[selectedMatch?.id ?? ""] ?? []);

  if (!selectedMatch || !selectedMarket) {
    return (
      <main className="loading-screen">
        <Zap />
        <strong>Carregando arena...</strong>
      </main>
    );
  }

  function placeBet() {
    if (stake <= 0) return showToast("Stake invalido.");
    if (stake > state.progress.balanceCents) return showToast("Saldo insuficiente.");
    if (!selectedMatch || !selectedMarket) return;

    const blockedCard = selectedCards.find((card) => lockedForMatch.has(card.id));
    if (blockedCard) return showToast(`${blockedCard.name} ja esta bloqueada nesta partida.`);

    const byType = selectedCards.reduce<Record<CardType, number>>(
      (acc, card) => {
        acc[card.type] += 1;
        return acc;
      },
      { moment: 0, power: 0, historic: 0 },
    );
    if (byType.moment > 1 || byType.power > 1 || byType.historic > 1) {
      return showToast("Use no maximo 1 carta por tipo.");
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
    showToast(packAvailable ? "Aposta criada. Starter Pack ja esta disponivel." : "Aposta criada.");
  }

  async function settleMatch() {
    const openPositions = state.positions.filter((position) => position.matchId === selectedMatch.id);
    if (!openPositions.length) return showToast("Nao ha posicoes abertas nesta partida.");

    const settledPositions = await Promise.all(
      openPositions.map((position) => settlePositionApi(position, selectedMatch)),
    );
    const payout = settledPositions.reduce((sum, position) => sum + position.payoutCents, 0);
    const wonCount = settledPositions.filter((position) => position.won).length;
    const anyLegendary = settledPositions.some((position) =>
      position.activatedCardIds.some((cardId) => allCards.find((card) => card.id === cardId)?.rarity === "legendary"),
    );

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

    showToast(
      `${wonCount}/${settledPositions.length} acertos. Bonus: ${formatCents(
        settledPositions.reduce((sum, position) => sum + position.bonusCents, 0),
      )}${anyLegendary ? " | Lendaria ativada." : ""}`,
    );
  }

  function openStarterPack() {
    if (!packAvailable) return;
    const awarded = Array.from({ length: 3 }, (_, index) => starterPackPool[index % starterPackPool.length].id);
    setState((current) => ({
      ...current,
      inventory: [...current.inventory, ...awarded],
      progress: { ...current.progress, packsOpened: current.progress.packsOpened + 1 },
    }));
    showToast(`Starter Pack aberto: ${awarded.map((id) => allCards.find((card) => card.id === id)?.name).join(", ")}.`);
  }

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY);
    setState(initialState);
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
    showToast("Demo reiniciada.");
  }

  function showToast(message: string) {
    setState((current) => ({ ...current, toast: message }));
    window.setTimeout(() => {
      setState((current) => ({ ...current, toast: "" }));
    }, 2600);
  }

  const earnedBadges = skillBadges.filter((badge) => {
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

  const visibleCards = allCards.filter((card) => state.selectedFilter === "all" || card.type === state.selectedFilter);
  const openPositions = state.positions.filter((position) => position.matchId === selectedMatch.id);
  const homeStats = teamStats(selectedMatch, selectedMatch.home);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TXLine hackathon app</p>
          <h1>Player Prediction Arena</h1>
        </div>
        <div className="wallet-strip" aria-label="Carteira do jogador">
          <Metric label="Saldo" value={formatCents(state.progress.balanceCents)} icon={<CircleDollarSign />} />
          <Metric label="Apostas" value={`${Math.min(state.progress.totalBets, 10)}/10`} icon={<Layers3 />} />
          <button className="ghost-button icon-button" type="button" onClick={resetDemo} title="Resetar demo">
            <RotateCcw size={18} />
            Reset
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="arena-panel" aria-labelledby="arenaTitle">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Match arena</p>
              <h2 id="arenaTitle">Mercado ao vivo</h2>
            </div>
            <select
              aria-label="Selecionar partida"
              value={selectedMatch.id}
              onChange={(event) => setState((current) => ({ ...current, selectedMatchId: event.target.value }))}
            >
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.home} vs {match.away}
                </option>
              ))}
            </select>
          </div>

          <div className="scoreboard">
            <TeamScore code={selectedMatch.homeCode} name={selectedMatch.home} score={selectedMatch.score[selectedMatch.home]} />
            <div className="match-clock">
              <span>{selectedMatch.status}</span>
              <strong>{selectedMatch.minute}</strong>
              <small>{selectedMatch.source === "txline" ? "TXLine proof" : "demo oracle"}</small>
            </div>
            <TeamScore
              alignRight
              code={selectedMatch.awayCode}
              name={selectedMatch.away}
              score={selectedMatch.score[selectedMatch.away]}
            />
          </div>

          <div className="pitch-band">
            <div className="pitch" aria-label="Visual abstrato do campo">
              <div className="center-line" />
              <div className="pitch-circle" />
              <div className="box box-left" />
              <div className="box box-right" />
              <div className="player-dot dot-a" />
              <div className="player-dot dot-b" />
              <div className="player-dot dot-c" />
              <div className="player-dot dot-d" />
              <div className="ball-dot" />
            </div>
            <div className="match-metrics">
              <Metric label="Posse" value={`${homeStats.possession}%`} />
              <Metric label="Finalizacoes contra" value={String(homeStats.shotsAgainst)} />
              <Metric label="Rating lider" value={selectedMatch.ratings[topRatedPlayer(selectedMatch)]?.toFixed(1) ?? "-"} />
            </div>
          </div>

          <div className="market-grid">
            {markets.map((market) => (
              <button
                className={`market-button ${market.id === selectedMarket.id ? "is-selected" : ""}`}
                key={market.id}
                type="button"
                onClick={() => setState((current) => ({ ...current, selectedMarketId: market.id }))}
              >
                <span>{market.kind}</span>
                <strong>{market.label}</strong>
                <small>odd {(market.oddsBps / 10000).toFixed(2)}</small>
              </button>
            ))}
          </div>

          <section className="trade-ticket" aria-label="Boleta de aposta">
            <label className="ticket-line">
              <span>Stake</span>
              <input
                min={1000}
                step={1000}
                type="number"
                value={stake / 100}
                onChange={(event) => setStake(Math.round(Number(event.target.value) * 100))}
              />
            </label>
            <div className="loadout-grid">
              <CardSelect
                label="Moment"
                cards={allCards}
                inventory={state.inventory}
                locked={lockedForMatch}
                type="moment"
                value={momentCardId}
                onChange={setMomentCardId}
              />
              <CardSelect
                label="Power"
                cards={allCards}
                inventory={state.inventory}
                locked={lockedForMatch}
                type="power"
                value={powerCardId}
                onChange={setPowerCardId}
              />
              <CardSelect
                label="Historic"
                cards={allCards}
                inventory={state.inventory}
                locked={lockedForMatch}
                type="historic"
                value={historicCardId}
                onChange={setHistoricCardId}
              />
            </div>
            <div className="ticket-summary">
              <div>
                <span>Mercado</span>
                <strong>{selectedMarket.label}</strong>
              </div>
              <div>
                <span>Bonus max.</span>
                <strong>{formatBps(selectedCards.reduce((sum, card) => sum + card.bonusBps, 0))}</strong>
              </div>
              <button className="primary-button icon-button" type="button" onClick={placeBet}>
                <Zap size={18} />
                Apostar
              </button>
            </div>
          </section>

          <section className="positions-panel">
            <div className="panel-heading compact">
              <h3>Posicoes abertas</h3>
              <button className="ghost-button icon-button" type="button" onClick={settleMatch}>
                <ShieldCheck size={18} />
                Liquidar
              </button>
            </div>
            <div className="position-list">
              {openPositions.length === 0 ? (
                <div className="position-card">Nenhuma posicao aberta nesta partida.</div>
              ) : (
                openPositions.map((position) => (
                  <div className="position-card" key={position.id}>
                    <div>
                      <span>{position.matchId}</span>
                      <strong>{position.marketLabel}</strong>
                      <small>{position.cardIds.length ? position.cardIds.join(", ") : "sem cartas"}</small>
                    </div>
                    <Metric label="Stake" value={formatCents(position.stakeCents)} />
                    <Metric label="Odd" value={(position.oddsBps / 10000).toFixed(2)} />
                  </div>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="side-panel" aria-label="Inventario e recompensas">
          <section className="pack-panel">
            <div className="pack-orb">
              <PackageOpen />
              <span>{Math.min(state.progress.totalBets, 10)}</span>
            </div>
            <div>
              <p className="eyebrow">Starter pack</p>
              <h2>3 cartas basicas</h2>
              <p className="muted">Liberado automaticamente apos 10 apostas.</p>
            </div>
            <button className="primary-button icon-button" type="button" disabled={!packAvailable} onClick={openStarterPack}>
              <PackageOpen size={18} />
              Abrir pack
            </button>
          </section>

          <section className="inventory-panel">
            <div className="panel-heading compact">
              <h3>Cartas</h3>
              <div className="tabs" role="tablist" aria-label="Filtro de cartas">
                {(["all", "moment", "power", "historic"] as Filter[]).map((filter) => (
                  <button
                    className={`tab ${state.selectedFilter === filter ? "is-active" : ""}`}
                    key={filter}
                    type="button"
                    onClick={() => setState((current) => ({ ...current, selectedFilter: filter }))}
                  >
                    {filter === "all" ? "Todas" : filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="card-grid">
              {visibleCards.map((card) => (
                <article className={`nft-card ${card.rarity}`} key={card.id}>
                  <div className="card-top">
                    <span className="card-type">{card.type}</span>
                    <strong className="card-bonus">{formatBps(card.bonusBps)}</strong>
                  </div>
                  <h4>{card.name}</h4>
                  <p className="card-meta">
                    {rarityLabel(card.rarity)} | owned {ownedCounts[card.id] ?? 0}
                  </p>
                  <p className="card-condition">{card.condition}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="badges-panel">
            <div className="panel-heading compact">
              <h3>Skill Badges</h3>
              <span className="pill">
                {earnedBadges.length}/{skillBadges.length}
              </span>
            </div>
            <div className="badge-list">
              {skillBadges.map((badge) => (
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

          <section className="settled-panel">
            <div className="panel-heading compact">
              <h3>Historico</h3>
              <Trophy size={20} />
            </div>
            <div className="position-list">
              {state.settled.slice(0, 5).map((position) => (
                <div className="position-card" key={position.id}>
                  <div>
                    <span>{position.won ? "win" : "loss"}</span>
                    <strong>{position.marketLabel}</strong>
                    <small>proof: {position.oracleProof}</small>
                  </div>
                  <Metric label="Payout" value={formatCents(position.payoutCents)} />
                  <Metric label="Bonus" value={formatCents(position.bonusCents)} />
                </div>
              ))}
              {state.settled.length === 0 && <div className="position-card">Sem liquidacoes ainda.</div>}
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

function TeamScore({
  alignRight,
  code,
  name,
  score,
}: {
  alignRight?: boolean;
  code: string;
  name: string;
  score: number;
}) {
  return (
    <div className={`team-block ${alignRight ? "align-right" : ""}`}>
      <span>{code}</span>
      <strong>{score}</strong>
      <small>{name}</small>
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
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Sem carta</option>
        {owned.map((card) => (
          <option disabled={locked.has(card.id)} key={card.id} value={card.id}>
            {card.name} ({formatBps(card.bonusBps)})
          </option>
        ))}
      </select>
    </label>
  );
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

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    currency: "BRL",
    style: "currency",
  });
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function rarityLabel(rarity: string): string {
  return {
    basic: "Basica",
    rare: "Rara",
    legendary: "Lendaria",
  }[rarity] ?? rarity;
}

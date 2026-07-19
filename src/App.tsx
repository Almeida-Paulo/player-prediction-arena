import {
  BadgeCheck,
  BarChart3,
  Bookmark,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Gift,
  HelpCircle,
  History,
  Mail,
  LifeBuoy,
  Link2,
  LockKeyhole,
  MapPin,
  Medal,
  PackageOpen,
  Plus,
  Search,
  ShieldCheck,
  Trophy,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import worldCupLogo from "../assets/fifa-world-cup-2026-logo-footylogos.svg";
import predictionLogo from "../assets/Prediction-Arena-logo.png";
import txoddsLogo from "../assets/TxODDS-Blue-on-Transparent-300x60.png.webp";
import usdcLogo from "../assets/usd-coin-usdc-logo.svg";
import { skillBadges } from "../shared/badges";
import { cards as cardCatalog, starterPackPool } from "../shared/cards";
import { markets as marketCatalog } from "../shared/demo-data";
import { teamStats, topRatedPlayer } from "../shared/settlement";
import type {
  CardDefinition,
  CardType,
  AuthProvider,
  MarketDefinition,
  MatchEvent,
  MatchSnapshot,
  PlatformLedgerEntry,
  PlatformPointEntry,
  PlatformUserState,
  PositionInput,
  SettledPosition,
  TeamLineup,
  UserProgress,
} from "../shared/types";
import {
  getPlatformMarketActivity,
  rankPlatformUsersBy,
  type PlatformHistoryPoint,
  type PlatformUser,
} from "./platform-activity";
import {
  createPlatformPosition,
  createPlatformMarket,
  createSolanaChallenge,
  getCatalog,
  getCurrentUser,
  getMatches,
  grantPlatformCredits,
  grantPlatformPoints,
  logoutPlatformUser,
  openPlatformPack,
  settlePlatformMatch,
  settlePositionApi,
  signInWithGoogle,
  verifySolanaChallenge,
} from "./services/api";

interface SolanaWalletProvider {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage?: (message: Uint8Array, encoding?: "utf8") => Promise<Uint8Array | { signature: Uint8Array }>;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
    solana?: SolanaWalletProvider;
  }
}

interface AppState {
  connected: boolean;
  userId: string;
  displayName: string;
  email: string;
  authProvider: AuthProvider;
  authSubject: string;
  walletAddress: string;
  role: "admin" | "player";
  progress: UserProgress;
  inventory: string[];
  positions: PositionInput[];
  settled: SettledPosition[];
  ledger: PlatformLedgerEntry[];
  pointLedger: PlatformPointEntry[];
  locks: Record<string, string[]>;
  selectedMatchId: string;
  selectedMarketId: string;
  toast: string;
}

type AccountView = "home" | "profile" | "rewards" | "leaderboard" | "help";
type AuthMode = "login" | "signup";

interface MarketItem {
  match: MatchSnapshot;
  market: MarketDefinition;
}

interface MarketActivity {
  volumeCents: number;
  positions: number;
  bettors: number;
  wonCents: number;
  history: PlatformHistoryPoint[];
}

interface SolanaAuthPayload {
  displayName: string;
  email: string;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const initialProgress: UserProgress = {
  balanceCents: 0,
  arenaPoints: 0,
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
  userId: "",
  displayName: "",
  email: "",
  authProvider: "wallet",
  authSubject: "",
  walletAddress: "",
  role: "player",
  progress: initialProgress,
  inventory: [],
  positions: [],
  settled: [],
  ledger: [],
  pointLedger: [],
  locks: {},
  selectedMatchId: "",
  selectedMarketId: "home-win",
  toast: "",
};

const categories = ["World Cup", "Crypto", "Politics", "Finance", "Culture", "Technology", "Climate"];

const authOptions: Array<{
  provider: "google" | "solana";
  label: string;
  detail: string;
}> = [
  {
    provider: "google",
    label: "Google",
    detail: "Fast account creation with a verified Gmail or Google Workspace email.",
  },
  {
    provider: "solana",
    label: "Solana wallet",
    detail: "Connect Phantom, Solflare or Backpack and sign a secure login message.",
  },
];

export function App() {
  const [matches, setMatches] = useState<MatchSnapshot[]>([]);
  const [markets, setMarkets] = useState<MarketDefinition[]>(marketCatalog);
  const [allCards, setAllCards] = useState<CardDefinition[]>(cardCatalog);
  const [state, setState] = useState<AppState>(initialState);
  const [stake, setStake] = useState(5000);
  const [momentCardId, setMomentCardId] = useState("");
  const [powerCardId, setPowerCardId] = useState("");
  const [historicCardId, setHistoricCardId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeView, setActiveView] = useState<AccountView>("home");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [marketComposerOpen, setMarketComposerOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

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
    let active = true;
    getCurrentUser()
      .then((platformState) => {
        if (!active) return;
        setState((current) => mergePlatformState(current, platformState, { connected: true }));
      })
      .catch(() => {
        if (!active) return;
        setState((current) => clearUserState(current));
      });
    return () => {
      active = false;
    };
  }, []);

  const featuredMatch = useMemo(() => pickLaunchMatch(matches), [matches]);
  const featuredMarket = useMemo(
    () => markets.find((market) => market.id === "home-win") ?? markets[0],
    [markets],
  );
  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === state.selectedMatchId) ?? featuredMatch ?? matches[0],
    [featuredMatch, matches, state.selectedMatchId],
  );

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === state.selectedMarketId) ?? featuredMarket ?? markets[0],
    [featuredMarket, markets, state.selectedMarketId],
  );

  const marketItems = useMemo<MarketItem[]>(
    () => buildLaunchMarketItems(matches, markets, featuredMatch?.id),
    [featuredMatch?.id, matches, markets],
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
  const lockedForMatch = new Set(state.locks[featuredMatch?.id ?? ""] ?? []);
  const earnedBadges = getEarnedBadges(state, allCards);
  const potentialGross = featuredMarket ? Math.floor((stake * featuredMarket.oddsBps) / 10000) : 0;
  const potentialProfit = Math.max(0, potentialGross - stake);
  const maxBonusBps = selectedCards.reduce((sum, card) => sum + card.bonusBps, 0);
  const maxBonus = Math.floor((potentialProfit * maxBonusBps) / 10000);
  const featuredActivity =
    featuredMatch && featuredMarket ? getMarketActivity(state, featuredMatch, featuredMarket) : emptyActivity();
  const trendingItems = useMemo(() => rankTrendingMarkets(marketItems, state).slice(0, 3), [marketItems, state]);
  const highestVolumeItems = useMemo(() => rankVolumeMarkets(marketItems, state).slice(0, 3), [marketItems, state]);

  async function connectWallet() {
    try {
      const platformState = await getCurrentUser();
      setState((current) => mergePlatformState(current, platformState, { connected: true }));
      setActiveView("home");
      showToast("Session connected.");
    } catch {
      setAuthMode("login");
    }
  }

  function signUp() {
    setAuthMode("signup");
  }

  async function submitGoogleCredential(credential: string) {
    try {
      const platformState = await signInWithGoogle({ credential });
      setState((current) => mergePlatformState(current, platformState, { connected: true }));
      setAuthMode(null);
      setActiveView("home");
      showToast("Google account connected.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to sign in with Google.");
    }
  }

  async function submitSolanaAuth(payload: SolanaAuthPayload) {
    try {
      if (!window.solana) throw new Error("Install Phantom, Solflare or another Solana wallet first.");
      const connection = await window.solana.connect();
      const walletAddress = connection.publicKey.toString();
      if (!window.solana.signMessage) throw new Error("This Solana wallet cannot sign login messages.");
      const challenge = await createSolanaChallenge(payload);
      const signed = await window.solana.signMessage(new TextEncoder().encode(challenge.message), "utf8");
      const signature = bytesToBase64(signed instanceof Uint8Array ? signed : signed.signature);
      const platformState = await verifySolanaChallenge({
        challengeId: challenge.challengeId,
        signature,
        walletAddress,
      });
      setState((current) => mergePlatformState(current, platformState, { connected: true }));
      setAuthMode(null);
      setActiveView("home");
      showToast("Solana wallet verified.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to sign in with Solana.");
    }
  }

  async function disconnectWallet() {
    await logoutPlatformUser();
    setState((current) => clearUserState(current));
    setActiveView("home");
    setUserMenuOpen(false);
    showToast("Signed out.");
  }

  function selectMatch(matchId: string) {
    setState((current) => ({ ...current, selectedMatchId: matchId }));
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
    setCardPickerOpen(false);
    setActiveView("home");
  }

  function selectMarket(matchId: string, marketId: string) {
    setState((current) => ({ ...current, selectedMatchId: matchId, selectedMarketId: marketId }));
    setMomentCardId("");
    setPowerCardId("");
    setHistoricCardId("");
    setCardPickerOpen(false);
    setActiveView("home");
  }

  async function placePrediction(
    targetMatch = featuredMatch,
    targetMarketId = featuredMarket?.id,
    outcome: "yes" | "no" = "yes",
  ) {
    if (!state.connected) return showToast("Login before placing predictions.");
    const targetMarket = markets.find((market) => market.id === targetMarketId) ?? selectedMarket;
    if (!targetMatch || !targetMarket) return showToast("Select an available World Cup market.");
    if (stake <= 0) return showToast("Stake must be greater than zero.");
    if (stake > state.progress.balanceCents) return showToast("Insufficient balance.");

    const lockedForTargetMatch = new Set(state.locks[targetMatch.id] ?? []);
    const blockedCard = selectedCards.find((card) => lockedForTargetMatch.has(card.id));
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
      team: marketTeam(targetMatch, targetMarket),
      player: targetMarket.id === "mom-home-team" ? targetMatch.mom : topRatedPlayer(targetMatch),
    };
    const [yesPercent, noPercent] = currentOutcomePercents(getMarketActivity(state, targetMatch, targetMarket), targetMarket.oddsBps);
    const displayedOddsBps = probabilityToOddsBps(outcome === "no" ? noPercent : yesPercent);
    const position: PositionInput = {
      id: crypto.randomUUID(),
      matchId: targetMatch.id,
      marketId: targetMarket.id,
      marketLabel: positionMarketLabel(targetMarket, targetMatch, outcome),
      outcome,
      stakeCents: stake,
      oddsBps: displayedOddsBps,
      context,
      cardIds: selectedCards.map((card) => card.id),
    };

    if (state.userId) {
      try {
        const platformState = await createPlatformPosition(state.userId, position);
        setState((current) =>
          mergePlatformState(current, platformState, {
            selectedMatchId: targetMatch.id,
            selectedMarketId: targetMarket.id,
          }),
        );
        showToast("Prediction registered in PostgreSQL. Balance, cards and history were updated.");
        return;
      } catch (error) {
        return showToast(error instanceof Error ? error.message : "Unable to place prediction.");
      }
    }

    setState((current) => ({
      ...current,
      selectedMarketId: targetMarket.id,
      progress: {
        ...current.progress,
        balanceCents: current.progress.balanceCents - stake,
        totalBets: current.progress.totalBets + 1,
        matchBetCounts: {
          ...current.progress.matchBetCounts,
          [targetMatch.id]: (current.progress.matchBetCounts[targetMatch.id] ?? 0) + 1,
        },
      },
      positions: [...current.positions, position],
      locks: {
        ...current.locks,
        [targetMatch.id]: [
          ...(current.locks[targetMatch.id] ?? []),
          ...selectedCards.map((card) => card.id),
        ],
      },
    }));
    showToast("Prediction placed locally. Backend user state is unavailable.");
  }

  async function settleMatch(targetMatch = featuredMatch) {
    if (!targetMatch) return;
    const matchOpenPositions = state.positions.filter((position) => position.matchId === targetMatch.id);
    if (!matchOpenPositions.length) return showToast("No open predictions on this match.");

    if (state.userId) {
      try {
        const platformState = await settlePlatformMatch(state.userId, targetMatch.id);
        const summary = (platformState as PlatformUserState & {
          settledSummary?: { count: number; won: number; bonusCents: number };
        }).settledSummary;
        setState((current) => mergePlatformState(current, platformState));
        if (summary) {
          showToast(`${summary.won}/${summary.count} settled as wins. Card bonus: ${formatCents(summary.bonusCents)}.`);
        } else {
          showToast("Match settled and account history updated.");
        }
        return;
      } catch (error) {
        return showToast(error instanceof Error ? error.message : "Unable to settle match.");
      }
    }

    let settledPositions: SettledPosition[];
    try {
      settledPositions = await Promise.all(matchOpenPositions.map((position) => settlePositionApi(position, targetMatch)));
    } catch (error) {
      return showToast(error instanceof Error ? error.message : "Unable to settle match.");
    }
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
        positions: current.positions.filter((position) => position.matchId !== targetMatch.id),
        settled: [...settledPositions, ...current.settled],
        locks: { ...current.locks, [targetMatch.id]: [] },
      };
    });

    const bonus = settledPositions.reduce((sum, position) => sum + position.bonusCents, 0);
    showToast(`${wonCount}/${settledPositions.length} settled as wins. Card bonus: ${formatCents(bonus)}.`);
  }

  async function openStarterPack() {
    if (!packAvailable) return;
    if (state.userId) {
      try {
        const platformState = await openPlatformPack(state.userId);
        setState((current) => mergePlatformState(current, platformState));
        showToast(`Starter Pack opened: ${(platformState.awarded ?? []).map((id) => allCards.find((card) => card.id === id)?.name ?? id).join(", ")}.`);
        return;
      } catch (error) {
        return showToast(error instanceof Error ? error.message : "Starter Pack is not available.");
      }
    }
    const awarded = Array.from({ length: 3 }, (_, index) => starterPackPool[index % starterPackPool.length].id);
    setState((current) => ({
      ...current,
      inventory: [...current.inventory, ...awarded],
      progress: { ...current.progress, packsOpened: current.progress.packsOpened + 1 },
    }));
    showToast(`Starter Pack opened: ${awarded.map((id) => allCards.find((card) => card.id === id)?.name).join(", ")}.`);
  }

  async function grantCredits(targetUserId: string, amountCents: number) {
    try {
      const platformState = await grantPlatformCredits({
        amountCents,
        note: "Hackathon demo credit",
        targetUserId,
      });
      if (targetUserId === state.userId) {
        setState((current) => mergePlatformState(current, platformState));
      }
      showToast(`Credited ${formatCents(amountCents)} to ${targetUserId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to grant credits.");
    }
  }

  async function grantPoints(targetUserId: string, points: number) {
    try {
      const platformState = await grantPlatformPoints({
        note: "Hackathon event points",
        points,
        targetUserId,
      });
      if (targetUserId === state.userId) {
        setState((current) => mergePlatformState(current, platformState));
      }
      showToast(`Credited ${formatPoints(points)} to ${targetUserId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to grant points.");
    }
  }

  async function createMarket(question: string, matchId: string) {
    if (!state.connected) {
      setAuthMode("signup");
      return showToast("Create an account before opening a market.");
    }
    try {
      const { market } = await createPlatformMarket({
        label: question.replace(/\?$/, ""),
        matchId,
        question,
      });
      setMarkets((current) => [market, ...current.filter((item) => item.id !== market.id)]);
      setState((current) => ({
        ...current,
        selectedMatchId: matchId || current.selectedMatchId,
        selectedMarketId: market.id,
      }));
      setMarketComposerOpen(false);
      showToast("Market created and saved to PostgreSQL.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to create market.");
    }
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

          <label className={`search-box ${searchOpen ? "is-open" : ""}`}>
            <Search size={20} />
            <input placeholder="Search markets, teams..." type="search" />
          </label>

          <button
            aria-expanded={searchOpen}
            aria-label="Search markets"
            className="search-toggle"
            type="button"
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search size={19} />
          </button>

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
              <button className="signup-button" type="button" onClick={signUp}>
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
            {featuredMatch && featuredMarket ? (
              <FeaturedMarket
                activity={featuredActivity}
                market={featuredMarket}
                match={featuredMatch}
                maxBonus={maxBonus}
                potentialGross={potentialGross}
                potentialProfit={potentialProfit}
                selectedCards={selectedCards}
                stake={stake}
                onChangeStake={setStake}
                onOpenCardPicker={() => setCardPickerOpen(true)}
                onPlacePrediction={placePrediction}
                onSettle={settleMatch}
              />
            ) : (
              <div className="empty-state tall">
                <Clock3 />
                <strong>Waiting for TXLine fixtures</strong>
                <p>Once the backend receives real World Cup data, this market will populate automatically.</p>
              </div>
            )}

            {selectedMatch && (
              <div className="mobile-lineup-wrapper">
                <LineupPreview match={selectedMatch} />
              </div>
            )}

            <section className="market-grid-section">
              <SectionTitle
                action={
                  <button className="section-action-button" type="button" onClick={() => setMarketComposerOpen(true)}>
                    <Plus size={15} />
                    Create market
                  </button>
                }
                eyebrow={isLoading ? "Loading fixtures" : ""}
                title="More World Cup predictions"
              />
              {marketItems.length ? (
                <div className="prediction-grid">
                  {marketItems.map((item) => (
                    <MarketCard
                      activity={getMarketActivity(state, item.match, item.market)}
                      isSelected={item.match.id === selectedMatch?.id && item.market.id === selectedMarket?.id}
                      item={item}
                      key={`${item.match.id}-${item.market.id}`}
                      onPlacePrediction={placePrediction}
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
            {matches.length > 0 && (
              <MatchResultsStrip
                matches={matches}
                selectedMatchId={selectedMatch?.id ?? ""}
                onSelect={selectMatch}
              />
            )}
            {selectedMatch && (
              <div className="desktop-lineup-wrapper">
                <LineupPreview match={selectedMatch} />
              </div>
            )}
            {selectedMatch && <TransferWatchPanel match={selectedMatch} />}
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
          userId={state.userId}
          onGrantCredits={grantCredits}
          onGrantPoints={grantPoints}
          onOpenPack={openStarterPack}
          onSelectView={setActiveView}
          onShowToast={showToast}
        />
      )}

      {cardPickerOpen && (
        <CardPickerModal
          cards={allCards}
          inventory={state.inventory}
          locked={lockedForMatch}
          selected={{ historic: historicCardId, moment: momentCardId, power: powerCardId }}
          onChangeHistoric={setHistoricCardId}
          onChangeMoment={setMomentCardId}
          onChangePower={setPowerCardId}
          onClose={() => setCardPickerOpen(false)}
        />
      )}

      {marketComposerOpen && (
        <MarketComposerModal
          matches={matches}
          selectedMatchId={selectedMatch?.id ?? featuredMatch?.id ?? ""}
          onClose={() => setMarketComposerOpen(false)}
          onCreate={createMarket}
        />
      )}

      {authMode && (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onGoogleCredential={submitGoogleCredential}
          onShowToast={showToast}
          onSolanaSubmit={submitSolanaAuth}
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
  market,
  match,
  maxBonus,
  potentialGross,
  potentialProfit,
  selectedCards,
  stake,
  onChangeStake,
  onOpenCardPicker,
  onPlacePrediction,
  onSettle,
}: {
  activity: MarketActivity;
  market: MarketDefinition;
  match: MatchSnapshot;
  maxBonus: number;
  potentialGross: number;
  potentialProfit: number;
  selectedCards: CardDefinition[];
  stake: number;
  onChangeStake: (value: number) => void;
  onOpenCardPicker: () => void;
  onPlacePrediction: (targetMatch?: MatchSnapshot, targetMarketId?: string, outcome?: "yes" | "no") => void;
  onSettle: () => void;
}) {
  const [yesPercent, noPercent] = currentOutcomePercents(activity, market.oddsBps);
  const [primaryOutcome, secondaryOutcome] = outcomeRows(market, match);
  const secondaryMarketId = oppositeResultMarketId(market.id);
  const selectedCardLabel = selectedCards.length
    ? selectedCards.map((card) => card.name).join(", ")
    : "No cards selected";

  return (
    <section className="featured-market-card">
      <div className="featured-toolbar">
        <div className="market-type">
          <span className="market-icon">
            <img alt="" src={worldCupLogo} />
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
            <OutcomeRow
              actionLabel={`Buy ${formatPercentCents(yesPercent)}`}
              label={primaryOutcome.label}
              logoUrl={primaryOutcome.logoUrl}
              teamCode={primaryOutcome.code}
              onAction={() => onPlacePrediction(match, market.id, "yes")}
            />
            <OutcomeRow
              actionLabel={`Buy ${formatPercentCents(noPercent)}`}
              label={secondaryOutcome.label}
              logoUrl={secondaryOutcome.logoUrl}
              teamCode={secondaryOutcome.code}
              tone="secondary"
              onAction={() => onPlacePrediction(match, secondaryMarketId ?? market.id, secondaryMarketId ? "yes" : "no")}
            />
          </div>

          <OddsStrip odds={match.odds ?? []} />

          <div className="market-meta-grid">
            <Metric icon={<Users />} label="Positions" value={String(activity.positions)} />
            <Metric icon={<CircleDollarSign />} label="Volume" value={formatCents(activity.volumeCents)} />
            <Metric icon={<BarChart3 />} label="Source" value={match.source.toUpperCase()} />
          </div>
        </div>

        <PositionShareChart
          activity={activity}
          noLabel={secondaryOutcome.label}
          noPercent={noPercent}
          yesLabel={primaryOutcome.label}
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

        <div className="card-loadout-field">
          <span>Card boosts</span>
          <button className="card-loadout-button" type="button" onClick={onOpenCardPicker}>
            <span>{selectedCardLabel}</span>
            <em>{selectedCards.length}/3</em>
          </button>
        </div>

        <div className="trade-actions">
          <button className="settle-button" type="button" onClick={onSettle}>
            <ShieldCheck size={17} />
            Settle
          </button>
        </div>
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
  const chartHistory = activity.history.length ? activity.history : [{ label: "Now", no: noPercent, volumeCents: 0, yes: yesPercent }];
  const maxPercent = chartMaxPercent(chartHistory);
  const yTicks = chartTicks(maxPercent);
  const xTicks = chartDateTicks(chartHistory);
  const lastPointX = chartX(chartHistory.length - 1, chartHistory.length);
  const yesLine = chartHistory.length ? historyLinePoints(chartHistory, "yes", maxPercent) : flatLinePoints(yesPercent, maxPercent);
  const noLine = chartHistory.length ? historyLinePoints(chartHistory, "no", maxPercent) : flatLinePoints(noPercent, maxPercent);

  return (
    <div className="position-chart-card">
      <svg className="line-chart" role="img" viewBox="0 0 340 176" aria-label="Platform probability history">
        {yTicks.map((tick) => {
          const y = chartY(tick, maxPercent);
          return (
            <g key={tick}>
              <line className="chart-rule" x1="12" x2="292" y1={y} y2={y} />
              <text className="chart-y-label" x="306" y={y + 4}>
                {tick}%
              </text>
            </g>
          );
        })}
        <polyline className="line yes" points={yesLine} />
        <polyline className="line no" points={noLine} />
        <circle className="line-dot yes" cx={lastPointX} cy={chartY(yesPercent, maxPercent)} r="4.5" />
        <circle className="line-dot no" cx={lastPointX} cy={chartY(noPercent, maxPercent)} r="4.5" />
      </svg>
      <div className="chart-x-axis">
        {xTicks.map((tick) => (
          <span key={`${tick.index}-${tick.label}`}>{tick.label}</span>
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

function OddsStrip({ odds }: { odds: MatchSnapshot["odds"] }) {
  const visibleOdds = resultOdds(odds ?? []);
  return (
    <div className="stableprice-strip">
      <div className="odds-brand">
        <span>odds by</span>
        <img alt="TxODDS" src={txoddsLogo} />
      </div>
      {visibleOdds.length ? (
        <div className="result-odds-grid">
          {visibleOdds.map((odd) => (
            <span className="result-odd" key={odd.id}>
              <small>{odd.shortLabel || shortOddsLabel(odd)}</small>
              <strong>{odd.selection}</strong>
              <em>{formatResultOdd(odd)}</em>
            </span>
          ))}
        </div>
      ) : (
        <p>Pre-match consensus odds appear here when TXODDS returns markets for this fixture.</p>
      )}
    </div>
  );
}

function OutcomeRow({
  actionLabel,
  disabled,
  label,
  logoUrl,
  teamCode,
  tone = "primary",
  onAction,
}: {
  actionLabel: string;
  disabled?: boolean;
  label: string;
  logoUrl?: string;
  teamCode: string;
  tone?: "primary" | "secondary";
  onAction: () => void;
}) {
  return (
    <div className={`outcome-row ${tone}`}>
      <TeamAvatar code={teamCode} logoUrl={logoUrl} />
      <strong>{label}</strong>
      <button
        className={`outcome-button ${tone === "primary" ? "yes-button" : "no-button"}`}
        disabled={disabled}
        type="button"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function MatchResultsStrip({
  matches,
  selectedMatchId,
  onSelect,
}: {
  matches: MatchSnapshot[];
  selectedMatchId: string;
  onSelect: (matchId: string) => void;
}) {
  return (
    <section className="fixture-results-strip" aria-label="World Cup match results">
      {matches.slice(0, 6).map((match) => {
        const homeScore = match.score[match.home] ?? 0;
        const awayScore = match.score[match.away] ?? 0;
        const isScheduled = match.status === "SCHEDULED";
        const topLabel = fixtureCardTopLabel(match);
        const bottomLabel = fixtureCardBottomLabel(match);
        return (
          <button
            className={`fixture-result-card ${match.id === selectedMatchId ? "is-selected" : ""} ${
              isScheduled ? "is-scheduled" : "is-played"
            }`}
            key={match.id}
            type="button"
            onClick={() => onSelect(match.id)}
          >
            <div className="fixture-side home">
              <FixtureFlag code={match.homeCode} logoUrl={match.homeLogoUrl} />
              <span>{match.homeCode}</span>
            </div>
            <div className="fixture-card-center">
              <span>{topLabel}</span>
              <strong>
                {isScheduled ? formatFixtureCardTime(match.startTime) : `${homeScore} - ${awayScore}`}
                {!isScheduled && <i aria-hidden="true" />}
              </strong>
              {bottomLabel && <small>{bottomLabel}</small>}
            </div>
            <div className="fixture-side away">
              <FixtureFlag code={match.awayCode} logoUrl={match.awayLogoUrl} />
              <span>{match.awayCode}</span>
            </div>
          </button>
        );
      })}
    </section>
  );
}

function FixtureFlag({ code, logoUrl }: { code: string; logoUrl?: string }) {
  const flagUrl = flagUrlForCode(code);
  if (flagUrl) {
    return <img alt="" className="fixture-flag" src={flagUrl} />;
  }
  if (logoUrl) {
    return <img alt="" className="fixture-flag logo" src={logoUrl} />;
  }
  return <span className="fixture-flag fallback">{code.slice(0, 3)}</span>;
}

function MarketGlyph({ market, match }: { market: MarketDefinition; match: MatchSnapshot }) {
  if (market.kind === "future") {
    return (
      <span className="market-card-icon future">
        <Trophy size={20} />
      </span>
    );
  }
  if (market.kind === "stats" || market.kind === "rating") {
    return (
      <span className="market-card-icon stats">
        <BarChart3 size={20} />
      </span>
    );
  }
  return (
    <span className="market-card-icon teams">
      <TeamAvatar code={match.homeCode} logoUrl={match.homeLogoUrl} />
      <TeamAvatar code={match.awayCode} logoUrl={match.awayLogoUrl} />
    </span>
  );
}

function MarketCard({
  activity,
  isSelected,
  item,
  onPlacePrediction,
  onSelect,
}: {
  activity: MarketActivity;
  isSelected: boolean;
  item: MarketItem;
  onPlacePrediction: (targetMatch?: MatchSnapshot, targetMarketId?: string, outcome?: "yes" | "no") => void;
  onSelect: () => void;
}) {
  const [yesPercent, noPercent] = currentOutcomePercents(activity, item.market.oddsBps);
  const [primaryOutcome, secondaryOutcome] = outcomeRows(item.market, item.match);
  const secondaryMarketId = oppositeResultMarketId(item.market.id);

  return (
    <article
      className={`prediction-card ${isSelected ? "is-selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="card-title-row">
        <MarketGlyph market={item.market} match={item.match} />
        <div>
          <span>{item.match.home} vs {item.match.away}</span>
          <strong>{marketQuestion(item.market, item.match)}</strong>
        </div>
      </div>
      <div className="mini-outcomes">
        <div>
          <span>{primaryOutcome.label}</span>
          <strong>{Math.round(yesPercent)}%</strong>
          <button
            className="mini-buy-button yes"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlacePrediction(item.match, item.market.id, "yes");
            }}
          >
            {formatPercentCents(yesPercent)}
          </button>
        </div>
        <div>
          <span>{secondaryOutcome.label}</span>
          <strong>{Math.round(noPercent)}%</strong>
          <button
            className="mini-buy-button no"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlacePrediction(item.match, secondaryMarketId ?? item.market.id, secondaryMarketId ? "yes" : "no");
            }}
          >
            {formatPercentCents(noPercent)}
          </button>
        </div>
      </div>
      <MarketCardOdds odds={item.match.odds ?? []} />
      <div className="card-footer">
        <span>{formatCents(activity.volumeCents)} vol.</span>
        <div>
          <Gift size={16} />
          <Bookmark size={16} />
        </div>
      </div>
    </article>
  );
}

function MarketCardOdds({ odds }: { odds: MatchSnapshot["odds"] }) {
  const visibleOdds = resultOdds(odds ?? []);
  if (!visibleOdds.length) {
    return null;
  }
  return (
    <div className="mini-odds">
      {visibleOdds.map((odd) => (
        <span className="mini-odd-cell" key={odd.id}>
          <small>{shortResultOddsLabel(odd)}</small>
          <strong>{formatResultOdd(odd)}</strong>
        </span>
      ))}
    </div>
  );
}

function LineupPreview({ match }: { match: MatchSnapshot }) {
  const homeLineup = match.lineups?.[match.home];
  const awayLineup = match.lineups?.[match.away];
  const hasLineups = Boolean(homeLineup?.starters.length || awayLineup?.starters.length);
  const title = match.status === "SCHEDULED" ? "expected lineups" : "confirmed lineups";
  const homeStats = teamStats(match, match.home);
  const awayStats = teamStats(match, match.away);
  const showStats = match.status !== "SCHEDULED";

  return (
    <section className="lineup-panel">
      <MatchSummaryCard match={match} />
      <div className="lineup-subhead">
        <span>{title}</span>
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
      <div className="lineup-stats">
        <StatComparison label="Possession" left={`${homeStats.possession}%`} right={`${awayStats.possession}%`} showValues={showStats} />
        <StatComparison label="Shots faced" left={String(homeStats.shotsAgainst)} right={String(awayStats.shotsAgainst)} showValues={showStats} />
        <StatComparison label="Corners faced" left={String(homeStats.cornersAgainst)} right={String(awayStats.cornersAgainst)} showValues={showStats} />
      </div>
      <PreviousPlayerRatings match={match} />
    </section>
  );
}

function MatchSummaryCard({ match }: { match: MatchSnapshot }) {
  const homeScore = match.score[match.home] ?? 0;
  const awayScore = match.score[match.away] ?? 0;
  const homeGoals = match.events.filter((event) => event.type === "goal" && sameTeam(event.team, match.home));
  const awayGoals = match.events.filter((event) => event.type === "goal" && sameTeam(event.team, match.away));
  const venue = [match.venueName, match.venueCity].filter(Boolean).join(", ");
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;
  return (
    <section className="match-summary-card">
      <div className="match-summary-score">
        <div className="summary-team">
          <strong>{match.home}</strong>
          <TeamAvatar code={match.homeCode} logoUrl={match.homeLogoUrl} />
        </div>
        <div className="summary-scoreline">
          <span>{matchStatusLabel(match)}</span>
          <strong>{match.status === "SCHEDULED" ? "vs" : `${homeScore} - ${awayScore}`}</strong>
          {match.status !== "SCHEDULED" && <em>{match.minute}</em>}
        </div>
        <div className="summary-team away">
          <TeamAvatar code={match.awayCode} logoUrl={match.awayLogoUrl} />
          <strong>{match.away}</strong>
        </div>
      </div>
      {hasGoals && (
        <div className="summary-goals">
          <GoalColumn events={homeGoals} />
          <GoalColumn events={awayGoals} />
        </div>
      )}
      <div className="summary-meta-row">
        <span>
          <Clock3 size={13} />
          {formatStart(match.startTime)}
        </span>
        <span>
          <Trophy size={13} />
          {match.competition ?? "World Cup"}
        </span>
        {venue && (
          <span>
            <MapPin size={13} />
            {venue}
          </span>
        )}
      </div>
    </section>
  );
}

function GoalColumn({ events }: { events: MatchEvent[] }) {
  if (!events.length) return <div className="goal-column" />;
  return (
    <div className="goal-column">
      {events.slice(0, 5).map((event, index) => (
        <span key={`${event.player}-${event.minute}-${index}`}>
          {event.player} {formatGoalMinute(event.minute)}
        </span>
      ))}
    </div>
  );
}

function TransferWatchPanel({ match }: { match: MatchSnapshot }) {
  const transfers = match.transfers ?? [];
  if (!transfers.length) return null;
  return (
    <section className="insight-panel transfer-panel">
      <div className="panel-heading">
        <h2>Transfer watch</h2>
        <History size={20} />
      </div>
      <div className="transfer-list">
        {transfers.slice(0, 5).map((transfer, index) => (
          <div className="transfer-row" key={`${transfer.playerName}-${transfer.date}-${index}`}>
            <strong>{transfer.playerName}</strong>
            <span>
              {[transfer.fromTeam, transfer.toTeam].filter(Boolean).join(" -> ") || transfer.type || "Transfer"}
            </span>
            {transfer.date && <em>{formatTransferDate(transfer.date)}</em>}
          </div>
        ))}
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
  const hasActivity = items.some((item) => getMarketActivity(state, item.match, item.market).positions > 0);

  return (
    <section className="insight-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {type === "trending" ? <TrendingUp size={20} /> : <CircleDollarSign size={20} />}
      </div>
      {!hasActivity && <p className="panel-note">{emptyLabel}</p>}
      <div className="insight-list">
        {items.map((item) => {
          const activity = getMarketActivity(state, item.match, item.market);
          const [probability] = currentOutcomePercents(activity, item.market.oddsBps);
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
  userId,
  onGrantCredits,
  onGrantPoints,
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
  userId: string;
  onGrantCredits: (targetUserId: string, amountCents: number) => void;
  onGrantPoints: (targetUserId: string, points: number) => void;
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
                <input defaultValue={state.displayName || "Prediction Arena Player"} />
              </label>
              <label className="field">
                <span>Email</span>
                <input readOnly value={state.email || "Not connected"} />
              </label>
              <label className="field">
                <span>Auth method</span>
                <input readOnly value={authProviderLabel(state.authProvider)} />
              </label>
              <label className="field">
                <span>Wallet</span>
                <input readOnly value={state.walletAddress || "Not connected"} />
              </label>
              <label className="field">
                <span>User ID</span>
                <input readOnly value={state.userId || "Create a session first"} />
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
            <div className="balance-grid">
              <div className="balance-hero">
                <UsdcIcon />
                <div>
                  <span>Available balance</span>
                  <strong>{formatUsdcCents(state.progress.balanceCents)}</strong>
                </div>
              </div>
              <div className="balance-hero points-hero">
                <Medal size={30} />
                <div>
                  <span>Arena Points</span>
                  <strong>{formatPoints(state.progress.arenaPoints)}</strong>
                </div>
              </div>
            </div>
            <div className="account-card account-actions-card">
              <div>
                <span>Starter Pack</span>
                <strong>{packAvailable ? "Unlocked" : "Locked until 10 predictions"}</strong>
              </div>
              <button className="signup-button" disabled={!packAvailable} type="button" onClick={onOpenPack}>
                <PackageOpen size={18} />
                Open starter pack
              </button>
            </div>

            <div className="account-grid two">
              <div className="account-card">
                <SectionTitle eyebrow="USDC" title="Prediction results" />
                <RewardHistory positions={state.positions} settled={state.settled} />
              </div>
              <div className="account-card">
                <SectionTitle eyebrow="NFT layer" title="Cards and badges" />
                <CardShelf cards={allCards} ownedCounts={ownedCounts} />
                <BadgeShelf badges={earnedBadges} />
              </div>
            </div>
            <div className="account-grid two">
              <div className="account-card">
                <SectionTitle eyebrow="USDC ledger" title="Balance activity" />
                <LedgerList ledger={state.ledger} />
              </div>
              <div className="account-card">
                <SectionTitle eyebrow="Points ledger" title="Arena Points activity" />
                <PointLedgerList pointLedger={state.pointLedger} />
              </div>
            </div>
            {state.role === "admin" && (
              <CreditDesk
                defaultTargetUserId={userId}
                ledger={state.ledger}
                onGrantCredits={onGrantCredits}
                onGrantPoints={onGrantPoints}
              />
            )}
          </div>
        )}

        {activeView === "leaderboard" && (
          <div className="account-stack">
            <SectionTitle eyebrow="Classification" title="Leaderboard" />
            <div className="leaderboard-grid">
              <LeaderboardTable
                currentMetric={`${state.progress.totalBets}`}
                label="Most predictions"
                metricKey="predictions"
                stats={stats}
              />
              <LeaderboardTable
                currentMetric={formatCents(stats.totalWonCents)}
                label="Total value won"
                metricKey="wonCents"
                stats={stats}
              />
              <LeaderboardTable
                currentMetric={formatPoints(state.progress.arenaPoints)}
                label="Arena Points"
                metricKey="arenaPoints"
                stats={stats}
              />
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

function AuthModal({
  mode,
  onClose,
  onGoogleCredential,
  onShowToast,
  onSolanaSubmit,
}: {
  mode: AuthMode;
  onClose: () => void;
  onGoogleCredential: (credential: string) => void;
  onShowToast: (message: string) => void;
  onSolanaSubmit: (payload: SolanaAuthPayload) => void;
}) {
  const [provider, setProvider] = useState<"google" | "solana">("google");
  const [displayName, setDisplayName] = useState("Prediction Arena Player");
  const [email, setEmail] = useState("");
  const googleSlotRef = useRef<HTMLDivElement | null>(null);
  const selected = authOptions.find((option) => option.provider === provider) ?? authOptions[0];
  const canSubmitSolana = Boolean(displayName.trim() && email.trim());

  useEffect(() => {
    if (provider !== "google" || !GOOGLE_CLIENT_ID || !googleSlotRef.current) return;
    let active = true;
    loadGoogleIdentity()
      .then(() => {
        if (!active || !window.google || !googleSlotRef.current) return;
        googleSlotRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response.credential) onGoogleCredential(response.credential);
          },
        });
        window.google.accounts.id.renderButton(googleSlotRef.current, {
          logo_alignment: "left",
          shape: "pill",
          size: "large",
          text: mode === "signup" ? "signup_with" : "signin_with",
          theme: "outline",
          width: "320",
        });
      })
      .catch(() => onShowToast("Google Identity could not be loaded."));
    return () => {
      active = false;
    };
  }, [mode, onGoogleCredential, onShowToast, provider]);

  return (
    <div className="card-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="auth-modal"
        role="dialog"
        aria-labelledby="auth-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="card-modal-header">
          <div>
            <span>{mode === "signup" ? "Create account" : "Login"}</span>
            <h2 id="auth-modal-title">Choose how to continue</h2>
          </div>
          <button aria-label="Close account dialog" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="auth-option-grid">
          {authOptions.map((option) => (
            <button
              className={`auth-option ${provider === option.provider ? "is-selected" : ""}`}
              key={option.provider}
              type="button"
              onClick={() => setProvider(option.provider)}
            >
              {option.provider === "google" ? <Mail size={18} /> : <ShieldCheck size={18} />}
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>

        {provider === "google" ? (
          <div className="google-auth-box">
            <div ref={googleSlotRef} />
            {!GOOGLE_CLIENT_ID && (
              <p>Google login needs `VITE_GOOGLE_CLIENT_ID` in the frontend environment and `GOOGLE_CLIENT_ID` on the API.</p>
            )}
          </div>
        ) : (
          <div className="profile-grid">
            <label className="field">
              <span>Display name</span>
              <input
                placeholder="Your public username"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="auth-summary">
          <ShieldCheck size={22} />
          <div>
            <strong>Admin-funded account balance</strong>
            <span>{selected.label} creates a real platform account. Deposits still come from an admin for this release.</span>
          </div>
        </div>

        <div className="card-modal-footer">
          <span>{selected.label}</span>
          {provider === "solana" && (
            <button
              className="signup-button"
              disabled={!canSubmitSolana}
              type="button"
              onClick={() => onSolanaSubmit({ displayName, email })}
            >
              Sign with Solana
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function MarketComposerModal({
  matches,
  selectedMatchId,
  onClose,
  onCreate,
}: {
  matches: MatchSnapshot[];
  selectedMatchId: string;
  onClose: () => void;
  onCreate: (question: string, matchId: string) => void;
}) {
  const [matchId, setMatchId] = useState(selectedMatchId);
  const [question, setQuestion] = useState("");
  const selected = matches.find((match) => match.id === matchId) ?? matches[0];
  const canCreate = question.trim().length >= 12 && Boolean(matchId);

  return (
    <div className="card-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="auth-modal market-composer-modal"
        role="dialog"
        aria-labelledby="market-composer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="card-modal-header">
          <div>
            <span>Create market</span>
            <h2 id="market-composer-title">Open a World Cup prediction</h2>
          </div>
          <button aria-label="Close market composer" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="profile-grid">
          <label className="field wide">
            <span>Fixture</span>
            <select value={matchId} onChange={(event) => setMatchId(event.target.value)}>
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.home} vs {match.away}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide">
            <span>Question</span>
            <textarea
              placeholder={selected ? `${selected.home} vs ${selected.away}: will the match have 4+ goals?` : "Will this market resolve as yes?"}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
        </div>
        <div className="composer-footer">
          <p>User-created markets start at 50/50 and require admin settlement until an oracle rule is attached.</p>
          <button
            className="signup-button"
            disabled={!canCreate}
            type="button"
            onClick={() => onCreate(question.trim(), matchId)}
          >
            <Plus size={17} />
            Create market
          </button>
        </div>
      </section>
    </div>
  );
}

function CreditDesk({
  defaultTargetUserId,
  ledger,
  onGrantCredits,
  onGrantPoints,
}: {
  defaultTargetUserId: string;
  ledger: PlatformLedgerEntry[];
  onGrantCredits: (targetUserId: string, amountCents: number) => void;
  onGrantPoints: (targetUserId: string, points: number) => void;
}) {
  const [targetUserId, setTargetUserId] = useState(defaultTargetUserId);
  const [amount, setAmount] = useState(250);
  const [points, setPoints] = useState(500);

  useEffect(() => {
    setTargetUserId(defaultTargetUserId);
  }, [defaultTargetUserId]);

  return (
    <div className="account-card credit-desk">
      <SectionTitle eyebrow="Admin" title="Credit desk" />
      <div className="credit-grid">
        <label className="field">
          <span>Target user</span>
          <input value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} />
        </label>
        <label className="field">
          <span>USDC amount</span>
          <input
            min={1}
            step={25}
            type="number"
            value={amount}
            onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))}
          />
        </label>
        <label className="field">
          <span>Event points</span>
          <input
            min={1}
            step={50}
            type="number"
            value={points}
            onChange={(event) => setPoints(Math.max(0, Number(event.target.value)))}
          />
        </label>
        <button
          className="signup-button"
          disabled={!targetUserId || amount <= 0}
          type="button"
          onClick={() => onGrantCredits(targetUserId, Math.round(amount * 100))}
        >
          Grant USDC
        </button>
        <button
          className="login-button"
          disabled={!targetUserId || points <= 0}
          type="button"
          onClick={() => onGrantPoints(targetUserId, Math.round(points))}
        >
          Grant points
        </button>
      </div>
      <LedgerList ledger={ledger} />
    </div>
  );
}

function LedgerList({ ledger }: { ledger: PlatformLedgerEntry[] }) {
  if (!ledger.length) return <div className="event-empty">No ledger entries yet.</div>;
  return (
    <div className="ledger-list">
      {ledger.slice(0, 6).map((entry) => (
        <div className="ledger-row" key={entry.id}>
          <span>{cleanMarketLabel(entry.type)}</span>
          <strong className={entry.amountCents >= 0 ? "is-positive" : "is-negative"}>
            {formatSignedCents(entry.amountCents)}
          </strong>
          <small>{entry.note || `Balance ${formatCents(entry.balanceAfterCents)}`}</small>
        </div>
      ))}
    </div>
  );
}

function PointLedgerList({ pointLedger }: { pointLedger: PlatformPointEntry[] }) {
  if (!pointLedger.length) return <div className="event-empty">No Arena Points events yet.</div>;
  return (
    <div className="ledger-list">
      {pointLedger.slice(0, 6).map((entry) => (
        <div className="ledger-row" key={entry.id}>
          <span>{cleanMarketLabel(entry.type)}</span>
          <strong className={entry.pointsDelta >= 0 ? "is-positive" : "is-negative"}>
            {formatSignedPoints(entry.pointsDelta)}
          </strong>
          <small>{entry.note || `${entry.pointsAfter.toLocaleString("en-US")} AP`}</small>
        </div>
      ))}
    </div>
  );
}

function UsdcIcon() {
  return (
    <span className="usdc-icon" aria-label="USDC">
      <img alt="" src={usdcLogo} />
    </span>
  );
}

function SectionTitle({ action, eyebrow, title }: { action?: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h2>{title}</h2>
      </div>
      {action}
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
  const flagUrl = flagUrlForCode(code);
  return logoUrl ? (
    <img alt="" className="team-avatar" src={logoUrl} />
  ) : flagUrl ? (
    <img alt="" className="team-avatar flag" src={flagUrl} />
  ) : (
    <span className="team-avatar fallback">{code.slice(0, 3)}</span>
  );
}

function PreviousPlayerRatings({ match }: { match: MatchSnapshot }) {
  const ratedPlayers = Object.entries(match.ratings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (!ratedPlayers.length) {
    return (
      <div className="previous-ratings is-empty">
        <strong>Previous match lineup</strong>
        <span>Unavailable from the connected feed for this fixture.</span>
      </div>
    );
  }

  return (
    <div className="previous-ratings">
      <div className="previous-ratings-heading">
        <strong>Previous match lineup</strong>
        <span>Ratings from connected data</span>
      </div>
      <div className="previous-player-grid">
        {ratedPlayers.map(([player, rating]) => (
          <div className="previous-player" key={player}>
            <span className="player-photo">{player.slice(0, 1)}</span>
            <div>
              <strong>{player}</strong>
              <span>Rating {rating.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardPickerModal({
  cards,
  inventory,
  locked,
  selected,
  onChangeHistoric,
  onChangeMoment,
  onChangePower,
  onClose,
}: {
  cards: CardDefinition[];
  inventory: string[];
  locked: Set<string>;
  selected: { historic: string; moment: string; power: string };
  onChangeHistoric: (value: string) => void;
  onChangeMoment: (value: string) => void;
  onChangePower: (value: string) => void;
  onClose: () => void;
}) {
  const ownedCounts = countCards(inventory);
  const ownedCards = cards.filter((card) => ownedCounts[card.id]);
  const selectedIds = new Set([selected.moment, selected.power, selected.historic].filter(Boolean));
  const selectedCount = selectedIds.size;

  function toggleCard(card: CardDefinition) {
    if (locked.has(card.id) && !selectedIds.has(card.id)) return;
    const nextValue = selectedIds.has(card.id) ? "" : card.id;
    if (card.type === "moment") onChangeMoment(nextValue);
    if (card.type === "power") onChangePower(nextValue);
    if (card.type === "historic") onChangeHistoric(nextValue);
  }

  return (
    <div className="card-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="card-modal"
        role="dialog"
        aria-labelledby="card-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="card-modal-header">
          <div>
            <span>Prediction boosts</span>
            <h2 id="card-modal-title">Choose up to 3 cards</h2>
          </div>
          <button aria-label="Close card picker" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="selected-loadout">
          <LoadoutSlot label="Moment" value={cardName(cards, selected.moment)} />
          <LoadoutSlot label="Power" value={cardName(cards, selected.power)} />
          <LoadoutSlot label="Historic" value={cardName(cards, selected.historic)} />
        </div>

        {ownedCards.length ? (
          <div className="card-choice-grid">
            {ownedCards.map((card) => {
              const isSelected = selectedIds.has(card.id);
              const isLocked = locked.has(card.id) && !isSelected;
              return (
                <button
                  className={`card-choice ${card.rarity} ${isSelected ? "is-selected" : ""}`}
                  disabled={isLocked}
                  key={card.id}
                  type="button"
                  onClick={() => toggleCard(card)}
                >
                  <div className="card-choice-top">
                    <span>{card.type}</span>
                    <strong>{formatBps(card.bonusBps)}</strong>
                  </div>
                  <h3>{card.name}</h3>
                  <p>{isLocked ? "Locked for this match." : card.condition}</p>
                  <div className="card-choice-bottom">
                    <small>
                      {card.rarity} x{ownedCounts[card.id]}
                    </small>
                    {isSelected && <Check size={18} />}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact">
            <PackageOpen />
            <strong>No cards available</strong>
            <p>After 10 predictions, the starter pack unlocks 3 basic cards.</p>
          </div>
        )}

        <div className="card-modal-footer">
          <span>{selectedCount}/3 selected</span>
          <button className="signup-button" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

function LoadoutSlot({ label, value }: { label: string; value: string }) {
  return (
    <div className="loadout-slot">
      <span>{label}</span>
      <strong>{value || "Empty"}</strong>
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

function StatComparison({
  label,
  left,
  right,
  showValues = true,
}: {
  label: string;
  left: string;
  right: string;
  showValues?: boolean;
}) {
  const leftNumber = numericStat(left);
  const rightNumber = numericStat(right);
  const total = leftNumber + rightNumber;
  const leftShare = total > 0 ? Math.max(4, Math.min(96, (leftNumber / total) * 100)) : 50;

  return (
    <div className={`stat-comparison ${showValues ? "" : "is-pending"}`}>
      <div className="stat-head">
        <span>{showValues ? left : ""}</span>
        <strong>{label}</strong>
        <span>{showValues ? right : ""}</span>
      </div>
      <div className="stat-track" aria-hidden="true">
        <i className="home-stat" style={{ width: showValues ? `${leftShare}%` : "50%" }} />
        <i className="away-stat" style={{ width: showValues ? `${100 - leftShare}%` : "50%" }} />
      </div>
      {!showValues && <small>Prematch</small>}
    </div>
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

function LeaderboardTable({
  currentMetric,
  label,
  metricKey,
  stats,
}: {
  currentMetric: string;
  label: string;
  metricKey: "predictions" | "wonCents" | "correctPredictions" | "arenaPoints";
  stats: ReturnType<typeof getAccountStats>;
}) {
  const leaders = rankPlatformUsersBy(metricKey).slice(0, 4);

  return (
    <div className="account-card leaderboard-card">
      <h3>{label}</h3>
      {leaders.map((user, index) => (
        <LeaderboardRow key={`${label}-${user.id}`} metricKey={metricKey} rank={index + 1} user={user} />
      ))}
      <div className="leaderboard-row is-you">
        <span>{leaders.length + 1}</span>
        <User size={18} />
        <strong>
          You
          <small>Connected account</small>
        </strong>
        <em>{currentMetric}</em>
      </div>
      <small>
        Demo stats: {stats.correctPredictions} correct, {formatCents(stats.totalWonCents)} won.
      </small>
    </div>
  );
}

function LeaderboardRow({
  metricKey,
  rank,
  user,
}: {
  metricKey: "predictions" | "wonCents" | "correctPredictions" | "arenaPoints";
  rank: number;
  user: PlatformUser;
}) {
  return (
    <div className="leaderboard-row">
      <span>{rank}</span>
      <User size={18} />
      <strong>
        {user.name}
        <small>{user.wallet}</small>
      </strong>
      <em>{formatLeaderboardMetric(user, metricKey)}</em>
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
      <span>{message}. Check the FastAPI service logs; if it is a 401 or 503, verify the TXLine network, guest JWT, and API token.</span>
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

function cardName(cards: CardDefinition[], cardId: string): string {
  if (!cardId) return "";
  return cards.find((card) => card.id === cardId)?.name ?? cardId;
}

function clearUserState(current: AppState): AppState {
  return {
    ...current,
    authProvider: "wallet",
    authSubject: "",
    connected: false,
    displayName: "",
    email: "",
    inventory: [],
    ledger: [],
    locks: {},
    pointLedger: [],
    positions: [],
    progress: initialProgress,
    role: "player",
    settled: [],
    userId: "",
    walletAddress: "",
  };
}

function mergePlatformState(current: AppState, platformState: PlatformUserState, extra: Partial<AppState> = {}): AppState {
  return {
    ...current,
    ...extra,
    connected: extra.connected ?? current.connected,
    authProvider: platformState.user.authProvider ?? "wallet",
    authSubject: platformState.user.authSubject ?? "",
    displayName: platformState.user.displayName,
    email: platformState.user.email ?? "",
    inventory: platformState.inventory,
    ledger: platformState.ledger,
    pointLedger: platformState.pointLedger ?? [],
    locks: buildLocks(platformState.positions),
    positions: platformState.positions,
    progress: { ...initialProgress, ...platformState.progress },
    role: platformState.user.role,
    settled: platformState.settled,
    userId: platformState.user.id,
    walletAddress: platformState.user.walletAddress,
  };
}

function buildLocks(positions: PositionInput[]): Record<string, string[]> {
  return positions.reduce<Record<string, string[]>>((acc, position) => {
    acc[position.matchId] = [...(acc[position.matchId] ?? []), ...position.cardIds];
    return acc;
  }, {});
}

function authProviderLabel(provider: AuthProvider): string {
  if (provider === "solana") return "Solana wallet";
  if (provider === "google") return "Google";
  return "Wallet";
}

function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("google_identity_failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("google_identity_failed"));
    document.head.appendChild(script);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
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
    const activityA = getMarketActivity(state, a.match, a.market);
    const activityB = getMarketActivity(state, b.match, b.market);
    return activityB.positions - activityA.positions || impliedProbability(b.market.oddsBps) - impliedProbability(a.market.oddsBps);
  });
  return ranked;
}

function rankVolumeMarkets(items: MarketItem[], state: AppState): MarketItem[] {
  const ranked = [...items].sort((a, b) => {
    const activityA = getMarketActivity(state, a.match, a.market);
    const activityB = getMarketActivity(state, b.match, b.market);
    return activityB.volumeCents - activityA.volumeCents || impliedProbability(b.market.oddsBps) - impliedProbability(a.market.oddsBps);
  });
  return ranked;
}

function buildLaunchMarketItems(matches: MatchSnapshot[], markets: MarketDefinition[], featuredMatchId?: string): MarketItem[] {
  const finalMatch = pickLaunchMatch(matches);
  const thirdPlaceMatch = matches.find(isWorldCupThirdPlace);
  const byId = new Map(markets.map((market) => [market.id, market]));

  const userCreated = markets
    .filter((market) => market.creatorRole === "user")
    .map((market) => {
      const match = matchForMarket(market, matches, finalMatch);
      return match ? { match, market } : null;
    })
    .filter((item): item is MarketItem => Boolean(item));

  const adminPlan: Array<{ match?: MatchSnapshot; marketId: string }> = [
    { match: thirdPlaceMatch, marketId: "home-win" },
    { match: finalMatch, marketId: "both-teams-score" },
    { match: finalMatch, marketId: "over-2-5-goals" },
    { match: finalMatch, marketId: "penalty-shootout" },
    { match: finalMatch, marketId: "extra-time" },
    { match: finalMatch, marketId: "home-possession-60" },
    { match: finalMatch, marketId: "world-cup-top-scorer" },
    { match: finalMatch, marketId: "world-cup-golden-ball" },
    { match: finalMatch, marketId: "world-cup-most-team-goals" },
    { match: finalMatch, marketId: "hat-trick-market" },
  ];

  const adminItems = adminPlan
    .map(({ match, marketId }) => {
      const market = byId.get(marketId);
      return match && market && marketAppliesToMatch(market, match) ? { match, market } : null;
    })
    .filter((item): item is MarketItem => Boolean(item));

  const deduped = new Map<string, MarketItem>();
  for (const item of [...userCreated, ...adminItems]) {
    const key = `${item.match.id}:${item.market.id}`;
    if (featuredMatchId && item.match.id === featuredMatchId && item.market.id === "home-win") continue;
    if (!deduped.has(key)) deduped.set(key, item);
  }
  return [...deduped.values()].slice(0, 9);
}

function matchForMarket(
  market: MarketDefinition,
  matches: MatchSnapshot[],
  fallback?: MatchSnapshot,
): MatchSnapshot | undefined {
  if (market.fixtureId) {
    return matches.find((match) => match.id === market.fixtureId);
  }
  if (market.scope === "third-place") return matches.find(isWorldCupThirdPlace) ?? fallback;
  if (market.scope === "final" || market.scope === "world-cup") return pickLaunchMatch(matches) ?? fallback;
  return fallback ?? matches[0];
}

function marketAppliesToMatch(market: MarketDefinition, match: MatchSnapshot): boolean {
  if (market.fixtureId) return market.fixtureId === match.id;
  if (!market.scope || market.scope === "all") return true;
  if (market.scope === "world-cup") return isWorldCupFinal(match);
  if (market.scope === "final") return isWorldCupFinal(match);
  if (market.scope === "third-place") return isWorldCupThirdPlace(match);
  return true;
}

function isWorldCupFinal(match: MatchSnapshot): boolean {
  const participants = teamPairKey(match);
  return participants === "argentina:spain";
}

function isWorldCupThirdPlace(match: MatchSnapshot): boolean {
  const participants = teamPairKey(match);
  return participants === "england:france";
}

function teamPairKey(match: MatchSnapshot): string {
  return [match.home, match.away].map((team) => team.toLowerCase()).sort().join(":");
}

function getMarketActivity(state: AppState, match: MatchSnapshot, market: MarketDefinition): MarketActivity {
  const platform = getPlatformMarketActivity(match, market);
  const open = state.positions.filter((position) => position.matchId === match.id && position.marketId === market.id);
  const settled = state.settled.filter((position) => position.matchId === match.id && position.marketId === market.id);
  const userPositions = open.length + settled.length;
  const userVolumeCents = [...open, ...settled].reduce((sum, position) => sum + position.stakeCents, 0);
  const userWonCents = settled.reduce(
    (sum, position) => sum + (position.won ? position.netProfitCents + position.bonusCents : 0),
    0,
  );
  const history = platform.history.map((point) => ({
    ...point,
    volumeCents:
      platform.volumeCents > 0
        ? point.volumeCents + Math.round(userVolumeCents * (point.volumeCents / platform.volumeCents))
        : point.volumeCents + userVolumeCents,
  }));

  return {
    bettors: platform.bettors + (userPositions > 0 && state.connected ? 1 : 0),
    history,
    positions: platform.positions + userPositions,
    volumeCents: platform.volumeCents + userVolumeCents,
    wonCents: platform.wonCents + userWonCents,
  };
}

function emptyActivity(): MarketActivity {
  return { bettors: 0, history: [], positions: 0, volumeCents: 0, wonCents: 0 };
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

interface OutcomeDisplay {
  code: string;
  label: string;
  logoUrl?: string;
}

function outcomeRows(market: MarketDefinition, match: MatchSnapshot): [OutcomeDisplay, OutcomeDisplay] {
  const home = { code: match.homeCode, label: match.home, logoUrl: match.homeLogoUrl };
  const away = { code: match.awayCode, label: match.away, logoUrl: match.awayLogoUrl };
  if (market.id === "home-win") return [home, away];
  if (market.id === "away-win") return [away, home];
  return [
    { code: "YES", label: "Yes" },
    { code: "NO", label: "No" },
  ];
}

function marketTeam(match: MatchSnapshot, market: MarketDefinition): string {
  if (market.contextTeam === "away") return match.away;
  if (market.contextTeam === "none") return match.home;
  if (market.id === "away-win") return match.away;
  return match.home;
}

function oppositeResultMarketId(marketId: string): string | undefined {
  if (marketId === "home-win") return "away-win";
  if (marketId === "away-win") return "home-win";
  return undefined;
}

const chartLeft = 12;
const chartRight = 292;
const chartTop = 16;
const chartBottom = 152;

function chartX(index: number, length: number): number {
  if (length <= 1) return chartRight;
  return chartLeft + ((chartRight - chartLeft) * index) / (length - 1);
}

function chartY(percent: number, maxPercent: number): number {
  const bounded = Math.max(0, Math.min(maxPercent, percent));
  return chartBottom - (bounded / maxPercent) * (chartBottom - chartTop);
}

function flatLinePoints(percent: number, maxPercent: number): string {
  const y = chartY(percent, maxPercent);
  return [0, 1, 2, 3, 4, 5].map((index) => `${chartX(index, 6)},${y}`).join(" ");
}

function historyLinePoints(history: PlatformHistoryPoint[], key: "yes" | "no", maxPercent: number): string {
  if (history.length <= 1) return flatLinePoints(history[0]?.[key] ?? 50, maxPercent);
  return history
    .map((point, index) => {
      const x = chartX(index, history.length);
      return `${x.toFixed(1)},${chartY(point[key], maxPercent).toFixed(1)}`;
    })
    .join(" ");
}

function chartMaxPercent(history: PlatformHistoryPoint[]): number {
  const highest = history.reduce((max, point) => Math.max(max, point.yes, point.no), 0);
  if (highest <= 60) return Math.max(15, Math.ceil(highest / 15) * 15);
  return 100;
}

function chartTicks(maxPercent: number): number[] {
  if (maxPercent > 60) return [100, 75, 50, 25, 0];
  const step = maxPercent <= 60 ? 15 : 25;
  const ticks: number[] = [];
  for (let tick = maxPercent; tick >= 0; tick -= step) ticks.push(tick);
  if (ticks[ticks.length - 1] !== 0) ticks.push(0);
  return ticks;
}

function chartDateTicks(history: PlatformHistoryPoint[]): Array<{ index: number; label: string }> {
  if (!history.length) return [];
  const lastIndex = history.length - 1;
  const indexes = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(lastIndex * ratio));
  return [...new Set(indexes)].map((index) => ({ index, label: history[index]?.label ?? "" }));
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    currency: "USD",
    style: "currency",
  });
}

function formatUsdcCents(cents: number): string {
  return `${formatCents(cents)} USDC`;
}

function formatSignedCents(cents: number): string {
  const absolute = formatCents(Math.abs(cents));
  if (cents > 0) return `+${absolute}`;
  if (cents < 0) return `-${absolute}`;
  return absolute;
}

function formatPoints(points: number): string {
  return `${points.toLocaleString("en-US")} AP`;
}

function formatSignedPoints(points: number): string {
  if (points > 0) return `+${formatPoints(points)}`;
  if (points < 0) return `-${formatPoints(Math.abs(points))}`;
  return formatPoints(points);
}

function currentOutcomePercents(activity: MarketActivity, fallbackOddsBps: number): [number, number] {
  const latest = activity.history[activity.history.length - 1];
  if (latest) return [latest.yes, latest.no];
  const yes = impliedProbability(fallbackOddsBps);
  return [yes, 100 - yes];
}

function probabilityToOddsBps(percent: number): number {
  const bounded = Math.max(1, Math.min(99, percent));
  return Math.round((100 / bounded) * 10000);
}

function positionMarketLabel(market: MarketDefinition, match: MatchSnapshot, outcome: "yes" | "no"): string {
  const side = outcome === "yes" ? "Yes" : "No";
  return `${side}: ${marketQuestion(market, match)}`;
}

function formatLeaderboardMetric(
  user: PlatformUser,
  metricKey: "predictions" | "wonCents" | "correctPredictions" | "arenaPoints",
): string {
  if (metricKey === "wonCents") return formatCents(user.wonCents);
  if (metricKey === "arenaPoints") return formatPoints(user.arenaPoints);
  return user[metricKey].toLocaleString("en-US");
}

function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function formatPercentCents(percent: number): string {
  return `${Math.max(1, Math.min(99, Math.round(percent)))}¢`;
}

function impliedProbability(oddsBps: number): number {
  if (!oddsBps) return 0;
  return Math.max(1, Math.min(99, (10000 / oddsBps) * 100));
}

function formatProbability(oddsBps: number): string {
  if (!oddsBps) return "--";
  return `${Math.round(impliedProbability(oddsBps))}¢`;
}

function formatNoProbability(oddsBps: number): string {
  if (!oddsBps) return "--";
  return `${Math.max(1, 100 - Math.round(impliedProbability(oddsBps)))}¢`;
}

function formatOdd(odd: NonNullable<MatchSnapshot["odds"]>[number]): string {
  if (odd.impliedProbability) return `${(odd.impliedProbability * 100).toFixed(1)}%`;
  if (odd.decimal) return `${odd.decimal.toFixed(2)}x`;
  if (odd.american) return odd.american > 0 ? `+${odd.american}` : String(odd.american);
  return "Live";
}

function formatResultOdd(odd: NonNullable<MatchSnapshot["odds"]>[number]): string {
  if (odd.decimal) return odd.decimal.toFixed(2);
  if (odd.impliedProbability) return `${(odd.impliedProbability * 100).toFixed(1)}%`;
  if (odd.american) return odd.american > 0 ? `+${odd.american}` : String(odd.american);
  return "--";
}

function cleanMarketLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Market";
}

function resultOdds(odds: NonNullable<MatchSnapshot["odds"]>): NonNullable<MatchSnapshot["odds"]> {
  const resultMarket = odds.filter(isMatchResultOdd);
  const byRole = new Map(resultMarket.map((odd) => [odd.selectionRole, odd]));
  const ordered = [byRole.get("home"), byRole.get("draw"), byRole.get("away")].filter(
    (odd): odd is NonNullable<MatchSnapshot["odds"]>[number] => Boolean(odd),
  );
  return ordered.length === 3 ? ordered : [];
}

function isMatchResultOdd(odd: NonNullable<MatchSnapshot["odds"]>[number]): boolean {
  const market = odd.market.toLowerCase();
  const isResultMarket =
    market.includes("1x2 participant result") ||
    (market.includes("1x2") && market.includes("participant") && market.includes("result"));
  return isResultMarket && (odd.selectionRole === "home" || odd.selectionRole === "draw" || odd.selectionRole === "away");
}

function shortOddsLabel(odd: NonNullable<MatchSnapshot["odds"]>[number]): string {
  if (odd.selectionRole === "home") return "1";
  if (odd.selectionRole === "draw") return "X";
  if (odd.selectionRole === "away") return "2";
  return "";
}

function shortResultOddsLabel(odd: NonNullable<MatchSnapshot["odds"]>[number]): string {
  if (odd.selectionRole === "home") return "1";
  if (odd.selectionRole === "draw") return "Draw";
  if (odd.selectionRole === "away") return "2";
  return odd.shortLabel || "";
}

function numericStat(value: string): number {
  const parsed = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function flagUrlForCode(code: string): string {
  const normalized = code.toUpperCase();
  const flagCodes: Record<string, string> = {
    ARG: "ar",
    BRA: "br",
    ENG: "gb-eng",
    FRA: "fr",
    JPN: "jp",
    MEX: "mx",
    NLD: "nl",
    POR: "pt",
    SPA: "es",
    USA: "us",
  };
  const flagCode = flagCodes[normalized];
  return flagCode ? `https://flagcdn.com/${flagCode}.svg` : "";
}

function marketQuestion(market: MarketDefinition, match: MatchSnapshot): string {
  switch (market.id) {
    case "home-win":
    case "away-win":
      return worldCupResultQuestion(match) ?? `Who will win, ${match.home} or ${match.away}?`;
    case "draw-after-90":
      return `Will ${match.home} vs ${match.away} be tied after regulation?`;
    case "both-teams-score":
      return `${match.home} vs ${match.away}: will both teams score?`;
    case "over-2-5-goals":
      return `${match.home} vs ${match.away}: will the match have 3+ goals?`;
    case "over-3-5-goals":
      return `${match.home} vs ${match.away}: will the match have 4+ goals?`;
    case "under-2-5-goals":
      return `${match.home} vs ${match.away}: will the match finish with under 3 goals?`;
    case "penalty-shootout":
      return `${match.home} vs ${match.away}: will the match go to penalties?`;
    case "extra-time":
      return `${match.home} vs ${match.away}: will the match go to extra time?`;
    case "home-goal":
      return `Will ${match.home} score?`;
    case "away-goal":
      return `Will ${match.away} score?`;
    case "home-2plus-goals":
      return `Will ${match.home} score 2+ goals?`;
    case "away-2plus-goals":
      return `Will ${match.away} score 2+ goals?`;
    case "home-first-goal":
      return `Will ${match.home} score first?`;
    case "home-clean-sheet":
      return `Will ${match.home} keep a clean sheet?`;
    case "away-clean-sheet":
      return `Will ${match.away} keep a clean sheet?`;
    case "home-possession-60":
      return `Will ${match.home} finish with 60%+ possession?`;
    case "away-possession-60":
      return `Will ${match.away} finish with 60%+ possession?`;
    case "home-most-corners":
      return `Will ${match.home} take more corners?`;
    case "away-most-corners":
      return `Will ${match.away} take more corners?`;
    case "hat-trick-market":
      return `${match.home} vs ${match.away}: will any player score a hat-trick?`;
    case "poker-trick-market":
      return `${match.home} vs ${match.away}: will any player score 4 goals?`;
    case "mom-home-team":
      return `Will the match MVP come from ${match.home}?`;
    case "mom-away-team":
      return `Will the match MVP come from ${match.away}?`;
    default:
      return market.question ?? market.label;
  }
}

function worldCupResultQuestion(match: MatchSnapshot): string | undefined {
  const participants = [match.home, match.away].map((team) => team.toLowerCase()).sort().join(":");
  if (participants === "argentina:spain") return "Who will win the World Cup?";
  if (participants === "england:france") return "Who will win the World Cup third-place match?";
  return undefined;
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

function formatFixtureTime(value?: string | number): string {
  if (!value) return "TBA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFixtureCardTime(value?: string | number): string {
  if (!value) return "TBA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

function formatFixtureDate(value?: string | number): string {
  if (!value) return "Date TBA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatFixtureDateShort(value?: string | number): string {
  if (!value) return "Date TBA";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

function formatTransferDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function matchStatusLabel(match: MatchSnapshot): string {
  if (match.status === "FINAL") return "Final";
  if (match.status === "LIVE") return match.minute || "Live";
  return "Scheduled";
}

function fixtureCardTopLabel(match: MatchSnapshot): string {
  const stage = fixtureStageLabel(match);
  if (match.status === "SCHEDULED") return stage || "Upcoming";
  return stage && stage.toLowerCase() !== "final"
    ? stage
    : `${matchStatusLabel(match)} - ${formatFixtureDateShort(match.startTime)}`;
}

function fixtureCardBottomLabel(match: MatchSnapshot): string {
  const date = formatFixtureDateShort(match.startTime);
  if (match.status === "SCHEDULED") return date;
  const stage = fixtureStageLabel(match);
  return stage && stage.toLowerCase() !== "final" ? `${matchStatusLabel(match)} - ${date}` : "";
}

function fixtureStageLabel(match: MatchSnapshot): string {
  const round = cleanFixtureRound(match.round);
  if (round && !["scheduled", "live", "final"].includes(round.toLowerCase())) return round;
  if (isWorldCupFinal(match)) return "Final";
  if (isWorldCupThirdPlace(match)) return "Third place";
  return round || "";
}

function cleanFixtureRound(value?: string | null): string {
  const normalized = String(value || "")
    .replace(/^world cup\s*[-:]\s*/i, "")
    .replace(/^fifa world cup\s*[-:]\s*/i, "")
    .trim();
  return normalized;
}

function sameTeam(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function formatGoalMinute(minute: number): string {
  return `${minute}'`;
}

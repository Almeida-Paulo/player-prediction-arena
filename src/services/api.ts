import { cards } from "../../shared/cards";
import { skillBadges } from "../../shared/badges";
import { markets } from "../../shared/demo-data";
import { settlePosition } from "../../shared/settlement";
import type { CardDefinition, MarketDefinition, MatchSnapshot, PlatformUserState, PositionInput, SettledPosition } from "../../shared/types";

export interface CatalogResponse {
  cards: CardDefinition[];
  badges: typeof skillBadges;
  markets: MarketDefinition[];
}

export async function getCatalog(): Promise<CatalogResponse> {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return (await response.json()) as CatalogResponse;
  } catch {
    return { cards, badges: skillBadges, markets };
  }
}

export async function getMatches(): Promise<MatchSnapshot[]> {
  const response = await fetch("/api/matches");
  if (!response.ok) throw new Error(`Matches HTTP ${response.status}`);
  return (await response.json()) as MatchSnapshot[];
}

export async function settlePositionApi(position: PositionInput, match: MatchSnapshot): Promise<SettledPosition> {
  try {
    const response = await fetch("/api/settle", {
      body: JSON.stringify(position),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error(`Settle HTTP ${response.status}`);
    return (await response.json()) as SettledPosition;
  } catch {
    return settlePosition(match, position);
  }
}

export async function getCurrentUser(): Promise<PlatformUserState> {
  const response = await fetch("/api/me", { credentials: "include" });
  if (!response.ok) throw new Error(`Me HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function signInWithGoogle(payload: { credential: string; displayName?: string }): Promise<PlatformUserState> {
  const response = await fetch("/api/auth/google", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Google auth HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function createSolanaChallenge(payload: { email: string; displayName: string }): Promise<{
  challengeId: string;
  message: string;
  expiresAt: string;
}> {
  const response = await fetch("/api/auth/solana/challenge", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Solana challenge HTTP ${response.status}`);
  return (await response.json()) as { challengeId: string; message: string; expiresAt: string };
}

export async function verifySolanaChallenge(payload: {
  challengeId: string;
  walletAddress: string;
  signature: string;
}): Promise<PlatformUserState> {
  const response = await fetch("/api/auth/solana/verify", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Solana verify HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function logoutPlatformUser(): Promise<void> {
  await fetch("/api/auth/logout", {
    credentials: "include",
    method: "POST",
  });
}

export async function getPlatformUserState(userId: string): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/state`, { credentials: "include" });
  if (!response.ok) throw new Error(`User state HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function createPlatformPosition(userId: string, position: PositionInput): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/positions`, {
    body: JSON.stringify(position),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Position HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function createPlatformMarket(payload: {
  question: string;
  label?: string;
  matchId?: string;
}): Promise<{ market: MarketDefinition }> {
  const response = await fetch("/api/markets", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Create market HTTP ${response.status}`);
  return (await response.json()) as { market: MarketDefinition };
}

export async function settlePlatformMatch(userId: string, matchId: string): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/settle-match/${encodeURIComponent(matchId)}`, {
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) throw new Error(`Settle match HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function openPlatformPack(userId: string): Promise<PlatformUserState & { awarded?: string[] }> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/open-pack`, {
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) throw new Error(`Open pack HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState & { awarded?: string[] };
}

export async function grantPlatformCredits(payload: {
  targetUserId: string;
  amountCents: number;
  note?: string;
}): Promise<PlatformUserState> {
  const response = await fetch("/api/admin/credits", {
    body: JSON.stringify({
      amountCents: payload.amountCents,
      note: payload.note,
      targetUserId: payload.targetUserId,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Admin credit HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function grantPlatformPoints(payload: {
  targetUserId: string;
  points: number;
  note?: string;
}): Promise<PlatformUserState> {
  const response = await fetch("/api/admin/points", {
    body: JSON.stringify({
      note: payload.note,
      points: payload.points,
      targetUserId: payload.targetUserId,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Admin points HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

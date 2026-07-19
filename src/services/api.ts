import { cards } from "../../shared/cards";
import { skillBadges } from "../../shared/badges";
import { markets } from "../../shared/demo-data";
import { settlePosition } from "../../shared/settlement";
import type { CardDefinition, MatchSnapshot, PlatformUserState, PositionInput, SettledPosition } from "../../shared/types";

export interface CatalogResponse {
  cards: CardDefinition[];
  badges: typeof skillBadges;
  markets: typeof markets;
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

export async function createPlatformUser(payload: {
  id?: string;
  displayName: string;
  walletAddress?: string;
}): Promise<PlatformUserState> {
  const response = await fetch("/api/users", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Create user HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function getPlatformUserState(userId: string): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/state`);
  if (!response.ok) throw new Error(`User state HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function createPlatformPosition(userId: string, position: PositionInput): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/positions`, {
    body: JSON.stringify(position),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Position HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function settlePlatformMatch(userId: string, matchId: string): Promise<PlatformUserState> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/settle-match/${encodeURIComponent(matchId)}`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`Settle match HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

export async function openPlatformPack(userId: string): Promise<PlatformUserState & { awarded?: string[] }> {
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}/open-pack`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`Open pack HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState & { awarded?: string[] };
}

export async function grantPlatformCredits(payload: {
  targetUserId: string;
  amountCents: number;
  note?: string;
  adminToken: string;
}): Promise<PlatformUserState> {
  const response = await fetch("/api/admin/credits", {
    body: JSON.stringify({
      amountCents: payload.amountCents,
      note: payload.note,
      targetUserId: payload.targetUserId,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": payload.adminToken,
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Admin credit HTTP ${response.status}`);
  return (await response.json()) as PlatformUserState;
}

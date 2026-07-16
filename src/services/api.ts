import { cards } from "../../shared/cards";
import { skillBadges } from "../../shared/badges";
import { markets } from "../../shared/demo-data";
import { settlePosition } from "../../shared/settlement";
import type { CardDefinition, MatchSnapshot, PositionInput, SettledPosition } from "../../shared/types";

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

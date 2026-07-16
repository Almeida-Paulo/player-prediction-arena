import type { MatchSnapshot } from "./types";

export function calculateLocalRatings(match: MatchSnapshot): Record<string, number> {
  const ratings: Record<string, number> = {};

  for (const event of match.events) {
    if (!ratings[event.player]) {
      ratings[event.player] = 6.2;
    }

    if (event.type === "goal") {
      ratings[event.player] += 1.1;
      if (event.tags.includes("decisive")) ratings[event.player] += 0.6;
      if (event.tags.includes("bicycle") || event.tags.includes("olympic")) ratings[event.player] += 0.5;
    }

    if (event.type === "card") {
      ratings[event.player] -= 0.5;
    }
  }

  for (const [player, value] of Object.entries(ratings)) {
    ratings[player] = Math.max(4.0, Math.min(10, Number(value.toFixed(1))));
  }

  return ratings;
}

export function pickManOfTheMatch(match: MatchSnapshot): string {
  const ratings = Object.keys(match.ratings).length > 0 ? match.ratings : calculateLocalRatings(match);
  return Object.entries(ratings).sort((a, b) => b[1] - a[1])[0]?.[0] ?? match.home;
}

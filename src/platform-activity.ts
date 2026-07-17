import type { MarketDefinition, MatchSnapshot } from "../shared/types";

export interface PlatformUser {
  id: string;
  name: string;
  wallet: string;
  predictions: number;
  correctPredictions: number;
  volumeCents: number;
  wonCents: number;
}

export interface PlatformHistoryPoint {
  label: string;
  yes: number;
  no: number;
  volumeCents: number;
}

export interface PlatformMarketActivity {
  volumeCents: number;
  positions: number;
  bettors: number;
  wonCents: number;
  history: PlatformHistoryPoint[];
}

export const platformUsers: PlatformUser[] = [
  {
    id: "usr-ava-stone",
    name: "Ava Stone",
    wallet: "0x8F3c...21C9",
    predictions: 284,
    correctPredictions: 171,
    volumeCents: 18425000,
    wonCents: 6934000,
  },
  {
    id: "usr-malik-reyes",
    name: "Malik Reyes",
    wallet: "0x4A91...E6B2",
    predictions: 251,
    correctPredictions: 152,
    volumeCents: 16592000,
    wonCents: 5818000,
  },
  {
    id: "usr-sofia-chen",
    name: "Sofia Chen",
    wallet: "0xC02D...7F4A",
    predictions: 229,
    correctPredictions: 146,
    volumeCents: 14936000,
    wonCents: 6245000,
  },
  {
    id: "usr-lucas-moretti",
    name: "Lucas Moretti",
    wallet: "0x6D77...18AE",
    predictions: 207,
    correctPredictions: 124,
    volumeCents: 13280000,
    wonCents: 4772000,
  },
  {
    id: "usr-priya-nair",
    name: "Priya Nair",
    wallet: "0x91BC...AA02",
    predictions: 194,
    correctPredictions: 119,
    volumeCents: 11945000,
    wonCents: 4390000,
  },
  {
    id: "usr-diego-silva",
    name: "Diego Silva",
    wallet: "0x21E9...0C3D",
    predictions: 181,
    correctPredictions: 106,
    volumeCents: 10388000,
    wonCents: 3826000,
  },
  {
    id: "usr-hana-novak",
    name: "Hana Novak",
    wallet: "0xB10F...C993",
    predictions: 164,
    correctPredictions: 98,
    volumeCents: 8846000,
    wonCents: 3511000,
  },
];

const historyPointCount = 60;
const historyStart = Date.UTC(2026, 4, 20);
const historyEnd = Date.UTC(2026, 6, 17);

export function getPlatformMarketActivity(match: MatchSnapshot, market: MarketDefinition): PlatformMarketActivity {
  const seed = hash(`${match.id}:${market.id}:${match.home}:${match.away}`);
  const baseProbability = clamp((10000 / market.oddsBps) * 100, 8, 92);
  const positions = Math.round(520 + seededNumber(seed, 1) * 5600);
  const bettors = Math.max(80, Math.round(positions * (0.42 + seededNumber(seed, 2) * 0.22)));
  const averageStakeCents = 1800 + Math.round(seededNumber(seed, 3) * 8600);
  const volumeCents = positions * averageStakeCents;
  const wonCents = Math.round(volumeCents * (0.18 + seededNumber(seed, 4) * 0.24));
  const history = buildHistory(seed, baseProbability, volumeCents);

  return {
    bettors,
    history,
    positions,
    volumeCents,
    wonCents,
  };
}

export function rankPlatformUsersBy(metric: "predictions" | "wonCents" | "correctPredictions"): PlatformUser[] {
  return [...platformUsers].sort((a, b) => b[metric] - a[metric]);
}

function buildHistory(seed: number, targetProbability: number, volumeCents: number): PlatformHistoryPoint[] {
  const targetYes = clamp(targetProbability, 3, 97);
  const targetNo = clamp(100 - targetYes, 3, 97);
  const startYes = clamp(targetYes * (0.18 + seededNumber(seed, 10) * 0.12), 4, 22);
  const startNo = clamp(targetNo * (0.18 + seededNumber(seed, 11) * 0.12), 4, 22);

  return Array.from({ length: historyPointCount }, (_, index) => {
    const progress = index / (historyPointCount - 1);
    const label = historyLabel(index);
    const yes = index === historyPointCount - 1 ? targetYes : marketCurve(seed, index, startYes, targetYes, progress, 20);
    const no = index === historyPointCount - 1 ? targetNo : marketCurve(seed, index, startNo, targetNo, progress, 80);

    return {
      label,
      no,
      volumeCents: Math.round(volumeCents * progress * (0.72 + seededNumber(seed, 90 + index) * 0.28)),
      yes,
    };
  });
}

function marketCurve(seed: number, index: number, start: number, target: number, progress: number, salt: number): number {
  const lateMove = Math.pow(progress, 5.2);
  const drift = start + (target - start) * lateMove;
  const pulse = Math.sin((progress * Math.PI * 5) + seededNumber(seed, salt) * Math.PI) * 1.2;
  const noise = (seededNumber(seed, salt + index) - 0.5) * 2.2;
  return clamp(drift + pulse + noise, 1, 99);
}

function historyLabel(index: number): string {
  const timestamp = historyStart + ((historyEnd - historyStart) * index) / (historyPointCount - 1);
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededNumber(seed: number, salt: number): number {
  let value = seed + Math.imul(salt + 1, 374761393);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

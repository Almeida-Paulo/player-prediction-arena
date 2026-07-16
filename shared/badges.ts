import type { SkillBadgeDefinition } from "./types";

export const skillBadges: SkillBadgeDefinition[] = [
  {
    id: "starter-scout",
    name: "Starter Scout",
    condition: "Open the first Starter Pack.",
    category: "onboarding",
  },
  {
    id: "pack-runner",
    name: "Pack Runner",
    condition: "Place 10 predictions and unlock the starter pack.",
    category: "onboarding",
  },
  {
    id: "sharp-scout",
    name: "Sharp Scout",
    condition: "Win 3 predictions in a row.",
    category: "prediction",
  },
  {
    id: "live-trader",
    name: "Live Trader",
    condition: "Create 3 predictions on the same match.",
    category: "prediction",
  },
  {
    id: "risk-manager",
    name: "Risk Manager",
    condition: "Win a prediction with stake up to 10% of pre-trade balance.",
    category: "risk",
  },
  {
    id: "oracle-believer",
    name: "Oracle Believer",
    condition: "Settle a prediction with a TXLine proof.",
    category: "oracle",
  },
  {
    id: "legend-caller",
    name: "Legend Caller",
    condition: "Activate a legendary card on a winning prediction.",
    category: "prediction",
  },
];

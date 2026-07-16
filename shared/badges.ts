import type { SkillBadgeDefinition } from "./types";

export const skillBadges: SkillBadgeDefinition[] = [
  {
    id: "starter-scout",
    name: "Starter Scout",
    condition: "Abrir o primeiro Starter Pack.",
    category: "onboarding",
  },
  {
    id: "pack-runner",
    name: "Pack Runner",
    condition: "Criar 10 apostas e liberar o pack inicial.",
    category: "onboarding",
  },
  {
    id: "sharp-scout",
    name: "Sharp Scout",
    condition: "Acertar 3 previsoes seguidas.",
    category: "prediction",
  },
  {
    id: "live-trader",
    name: "Live Trader",
    condition: "Criar 3 apostas na mesma partida.",
    category: "prediction",
  },
  {
    id: "risk-manager",
    name: "Risk Manager",
    condition: "Vencer uma aposta com stake de ate 10% do saldo pre-aposta.",
    category: "risk",
  },
  {
    id: "oracle-believer",
    name: "Oracle Believer",
    condition: "Liquidar uma previsao com prova TXLine.",
    category: "oracle",
  },
  {
    id: "legend-caller",
    name: "Legend Caller",
    condition: "Ativar uma carta lendaria em uma previsao vencedora.",
    category: "prediction",
  },
];

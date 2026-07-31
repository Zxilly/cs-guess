import { t } from "@lingui/core/macro";
import generatedPlayers from "./players.generated.json";

export type PlayerRole = "AWPer" | "Rifler" | "IGL" | "Entry" | "Unknown";

export function playerRoleNameZh(role: PlayerRole) {
  switch (role) {
    case "AWPer":
      return t`狙击手`;
    case "Rifler":
      return t`步枪手`;
    case "IGL":
      return t`指挥`;
    case "Entry":
      return t`突破手`;
    default:
      return t`未知`;
  }
}

export interface Player {
  id: string;
  nickname: string;
  aliases?: readonly string[];
  name: string;
  team: string;
  historicalTeams?: readonly string[];
  teamLogoUrl?: string;
  imageUrl?: string;
  nationality: string;
  countryCode: string;
  age: number;
  role: PlayerRole;
  majorAppearances: number;
  majorWins: number;
}

export const players = generatedPlayers as readonly Player[];

import generatedPlayers from "./players.generated.json";

export type PlayerRole = "AWPer" | "Rifler" | "IGL" | "Entry";

const playerRoleNames: Record<PlayerRole, string> = {
  AWPer: "狙击手",
  Rifler: "步枪手",
  IGL: "指挥",
  Entry: "突破手",
};

export function playerRoleNameZh(role: PlayerRole) {
  return playerRoleNames[role];
}

export interface Player {
  id: string;
  nickname: string;
  name: string;
  team: string;
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

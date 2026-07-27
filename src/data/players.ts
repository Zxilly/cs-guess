import generatedPlayers from "./players.generated.json";

export type PlayerRole = "AWPer" | "Rifler" | "IGL" | "Entry";

export interface Player {
  id: string;
  nickname: string;
  name: string;
  team: string;
  teamLogoUrl?: string;
  nationality: string;
  countryCode: string;
  age: number;
  role: PlayerRole;
  majorAppearances: number;
  majorWins: number;
}

export const players = generatedPlayers as readonly Player[];

export interface Game {
  opponentSlug: string;
  opponentName: string;
  won: boolean | null; // null = tie
}

export interface TeamSchedule {
  games: Game[];
  classification: number | "oos";
  fetchedAt: string; // ISO timestamp
}

export interface RpiResult {
  team: string;
  classification: string;
  record: string;
  gamesCounted: number;
  opponentsCounted: number;
  oppOppCounted: number;
  mwp: number;
  owp: number;
  oowp: number;
  rpi: number;
  computedAt: string;
  formula: string;
}

export interface KVPayload {
  result: RpiResult;
  scheduleCache: Record<string, TeamSchedule>;
}

export interface Env {
  MAXPREPS_RPI: KVNamespace;
}

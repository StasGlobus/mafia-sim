export type Role = "villager" | "wolf" | "seer" | "doctor";
export type Personality =
  | "chatty"
  | "quiet"
  | "suspicious"
  | "rambling"
  | "joker"
  | "anxious"
  | "cold"
  | "naive";

export type Phase =
  | "lobby"
  | "dawn"
  | "day"
  | "hang"
  | "night_wolves"
  | "night_seer"
  | "night_doctor"
  | "ended";

export type Channel = "public" | "wolves" | "seer" | "doctor" | "events" | "none";

export type Speed = 1 | 2 | 4;

export interface Player {
  id: string;
  name: string;
  role: Role;
  personality: Personality;
  alive: boolean;
  muted: boolean;
  cannotVote: boolean;
}

export interface ChatMessage {
  id: string;
  channel: Exclude<Channel, "none">;
  authorId: string | null;
  authorName: string;
  text: string;
  ts: number;
  narrator?: boolean;
}

export interface GameConfig {
  dayMs: number;
  nightStepMs: number;
  dawnMs: number;
  hangMs: number;
}

export interface NightPicks {
  wolfTarget: string | null;
  seerTarget: string | null;
  doctorTarget: string | null;
}

export interface AgentMemory {
  known: Record<string, "wolf" | "not_wolf">;
  messagesToday: number;
  lastText: string;
  plannedVote: string | null;
  spokeAtProgress: number[];
}

export interface LastKill {
  playerId: string | null;
  name: string | null;
  role: Role | null;
  saved: boolean;
}

export interface GameState {
  id: string;
  status: "idle" | "running" | "paused" | "ended";
  phase: Phase;
  dayNumber: number;
  speed: Speed;
  config: GameConfig;
  players: Player[];
  messages: ChatMessage[];
  votes: Record<string, string>;
  night: NightPicks;
  lastKill: LastKill | null;
  hangTarget: string | null;
  winner: "town" | "wolves" | null;
  winnerText: string;
  openChannel: Channel;
  phaseElapsedMs: number;
  phaseDurationMs: number;
  lastTickAt: number;
  lastPulseAt: number;
  createdAt: number;
  eventLog: string[];
  memories: Record<string, AgentMemory>;
  usedPublicTexts: string[];
}

export const DEFAULT_CONFIG: GameConfig = {
  dayMs: 45_000,
  nightStepMs: 20_000,
  dawnMs: 12_000,
  hangMs: 8_000,
};

export const ROLE_HE: Record<Role, string> = {
  villager: "תושב",
  wolf: "זאב",
  seer: "רואה",
  doctor: "רופא",
};

export const PERSONALITY_HE: Record<Personality, string> = {
  chatty: "דברן",
  quiet: "שקט",
  suspicious: "חשדן",
  rambling: "מקשקש",
  joker: "בדחן",
  anxious: "חרד",
  cold: "קר",
  naive: "תמים",
};

export const PHASE_HE: Record<Phase, string> = {
  lobby: "התחלה",
  dawn: "בוקר",
  day: "יום",
  hang: "תלייה",
  night_wolves: "לילה, זאבים",
  night_seer: "לילה, רואה",
  night_doctor: "לילה, רופא",
  ended: "נגמר",
};

export const CHANNEL_HE: Record<Channel, string> = {
  public: "הצ'אט",
  wolves: "זאבים",
  seer: "רואה",
  doctor: "רופא",
  events: "אירועים",
  none: "סגור",
};

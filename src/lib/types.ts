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
  | "wait"
  | "dawn"
  | "day"
  | "hang"
  | "night_wolves"
  | "night_seer"
  | "night_doctor"
  | "ended";

export type PlayerKind = "human" | "agent";

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
  kind?: PlayerKind;
  realName?: string | null;
  host?: boolean;
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
  wait: "סגור",
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


export interface LiveSchedule {
  timezone: "Asia/Jerusalem";
  days: number[];
  dayStart: string;
  dayEnd: string;
}

export const DEFAULT_SCHEDULE: LiveSchedule = {
  timezone: "Asia/Jerusalem",
  days: [0, 1, 2, 3, 4, 5, 6],
  dayStart: "10:00",
  dayEnd: "22:00",
};

export const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface DeathReveal {
  playerId: string;
  name: string;
  role: Role;
  kind: PlayerKind;
  realName: string | null;
  how: string;
  dayNumber: number;
  ts: number;
}

export interface LiveGame extends GameState {
  code: string;
  hostId: string;
  schedule: LiveSchedule;
  startedAt: number | null;
  secrets: Record<string, string>;
  deaths: DeathReveal[];
  nextLockAt: number;
  waitWeekday: number | null;
  lastAgentPulseAt: number;
  windowStartAt: number;
  nightThirdMs: number;
  nightEndAt: number;
}

export interface LiveMeView {
  playerId: string;
  fakeName: string;
  realName: string;
  role: Role | null;
  alive: boolean;
  muted: boolean;
  cannotVote: boolean;
  isHost: boolean;
  canSpeak: boolean;
  canVote: boolean;
  canNightPick: boolean;
  nightAction: "wolf" | "seer" | "doctor" | null;
  pack: string[];
  inspections: { name: string; result: string }[];
  myVote: string | null;
  myNightPick: string | null;
}

export interface LivePlayerView {
  id: string;
  name: string;
  alive: boolean;
  isMe: boolean;
  role: Role | null;
  votes: number;
  voters: string[];
}

export interface LiveView {
  code: string;
  sharePath: string;
  status: "lobby" | "running" | "ended";
  phase: Phase;
  phaseLabel: string;
  dayNumber: number;
  schedule: LiveSchedule;
  nextLockAt: string | null;
  nextLockPretty: string | null;
  waitText: string | null;
  players: LivePlayerView[];
  messages: ChatMessage[];
  lastKill: { name: string | null; saved: boolean } | null;
  deaths: { name: string; text: string; role: Role; kind: PlayerKind }[];
  winner: "town" | "wolves" | null;
  winnerText: string;
  humansJoined: number;
  seats: number;
  me: LiveMeView;
  now: string;
}

export const ROLE_ART: Record<Role, string> = {
  villager: "/art/villager.png",
  wolf: "/art/wolf.png",
  seer: "/art/seer.png",
  doctor: "/art/doctor.png",
};

export const LIVE_SEATS = 8;

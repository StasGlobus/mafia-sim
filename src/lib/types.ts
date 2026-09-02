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

export type Speed = 1 | 2 | 4 | 8 | 16;
export type IdentityMode = "aliases" | "real";
export type BotMode = "fill" | "humans_only";
export type DirectorStyle = "classic" | "dynamic" | "wild";
/** `scheduled` plays one day per calendar day inside play hours; `quick` runs in minutes. */
export type GameMode = "scheduled" | "quick";
export type Gender = "m" | "f";

export interface LiveRules {
  seats: number;
  wolfCount: number;
  hasSeer: boolean;
  hasDoctor: boolean;
  identityMode: IdentityMode;
  botMode: BotMode;
  directorStyle: DirectorStyle;
  mode: GameMode;
  /** Quick mode only: length of a day in minutes. */
  quickDayMinutes: number;
  /** Quick mode only: length of a whole night in minutes. */
  quickNightMinutes: number;
}

export const DEFAULT_LIVE_RULES: LiveRules = {
  seats: 8,
  wolfCount: 2,
  hasSeer: true,
  hasDoctor: true,
  identityMode: "aliases",
  botMode: "fill",
  directorStyle: "dynamic",
  mode: "scheduled",
  quickDayMinutes: 8,
  quickNightMinutes: 3,
};

export const QUICK_DAY_OPTIONS = [5, 8, 12, 20] as const;
export const QUICK_NIGHT_OPTIONS = [2, 3, 5] as const;

export type DirectorEventType = "omen" | "silence" | "lost_vote" | "leak" | "blood_moon";

export interface DirectorEvent {
  id: string;
  type: DirectorEventType;
  title: string;
  text: string;
  dayNumber: number;
  ts: number;
}

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
  /** Grammatical gender for Hebrew agreement. */
  gender?: Gender;
}

export interface ChatMessage {
  id: string;
  channel: Exclude<Channel, "none">;
  authorId: string | null;
  authorName: string;
  text: string;
  ts: number;
  narrator?: boolean;
  /** The message this agent reply answered. Used to prevent reply loops. */
  replyToId?: string;
  /** Visual tone for narrator messages. */
  tone?: "recap" | "alert" | "director" | "reveal";
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
  /** Most recent direct question this agent has already handled. */
  lastDirectMessageId?: string;
  /** Live-game scheduler. Times are epoch ms; null means nothing planned. */
  nextSpeakAt?: number | null;
  reaction?: AgentReaction | null;
  voteAt?: number | null;
  closingAt?: number | null;
  actAt?: number | null;
  budgetToday?: number;
  reactionsToday?: number;
  lastSpokeAt?: number;
  reactedToMorning?: boolean;
  /** Who this agent suspects and how strongly. Positive means suspicious. */
  suspicion?: Record<string, number>;
  /** Short Hebrew reason per suspect, for consistent talk. */
  reasons?: Record<string, string>;
  /** What this agent said today, so it stays consistent. */
  saidToday?: string[];
  claimed?: boolean;
}

export interface AgentReaction {
  kind: "reply" | "defend" | "react" | "push" | "claim" | "wolf_plan";
  dueAt: number;
  messageId?: string;
  aboutId?: string;
}

export interface LastLynch {
  targetId: string;
  role: Role;
  voters: string[];
  dayNumber: number;
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
  /** Public role claims (player id to role). */
  claims?: Record<string, Role>;
  lastLynch?: LastLynch | null;
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

export const WEEKDAY_CHIPS: { i: number; l: string }[] = [
  { i: 0, l: "א" },
  { i: 1, l: "ב" },
  { i: 2, l: "ג" },
  { i: 3, l: "ד" },
  { i: 4, l: "ה" },
  { i: 5, l: "ו" },
  { i: 6, l: "ש" },
];

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
  rules: LiveRules;
  directorEvents: DirectorEvent[];
  remindersSent?: string[];
  lastHumanActionAt?: number;
}

export interface LiveMeView {
  playerId: string;
  fakeName: string;
  realName: string;
  gender: Gender;
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
  gender: Gender;
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
  rules: LiveRules;
  directorEvents: DirectorEvent[];
  /** Agents about to write in the channel the viewer can see right now. */
  typing: string[];
  me: LiveMeView;
  now: string;
}

export interface AdminPlayerView {
  id: string;
  name: string;
  gender: Gender;
  realName: string | null;
  kind: PlayerKind;
  alive: boolean;
  role: Role | null;
  personality: Personality;
}

export interface AdminView extends Omit<LiveView, "players"> {
  isAdmin: true;
  players: AdminPlayerView[];
  wolfMsgs: ChatMessage[];
  seerMsgs: ChatMessage[];
  doctorMsgs: ChatMessage[];
  night: {
    wolfTargetName: string | null;
    seerTargetName: string | null;
    doctorTargetName: string | null;
  };
  eventLog: string[];
}

export const ROLE_ART: Record<Role, string> = {
  villager: "/art/villager.png",
  wolf: "/art/wolf.png",
  seer: "/art/seer.png",
  doctor: "/art/doctor.png",
};

export const LIVE_SEATS = 8;
export const MIN_LIVE_SEATS = 5;
export const MAX_LIVE_SEATS = 12;
export const ROOM_CODE_LENGTH = 6;

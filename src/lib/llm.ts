import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { GameState, Player } from "./types";
import { PERSONALITY_HE, ROLE_HE } from "./types";

const MINI = "gpt-4.1-mini";

const PERSONA: Record<Player["personality"], string> = {
  chatty: "אתה דברן. כותב הרבה אבל קצר כל פעם. מקפיץ שיחה.",
  quiet: "אתה שקט. לרוב מילה-שתיים. לא מסביר.",
  suspicious: "אתה חשדן. מחפש שקר. לא פואטי.",
  rambling: "אתה מקשקש. משפט ארוך אחד שנשבר באמצע.",
  joker: "יבש, ציני. לא סטנדאפיסט.",
  anxious: "לחוץ. קוצר נשימה בטקסט. לא מלודרמה.",
  cold: "קר. נקודה. בלי רגש.",
  naive: "תמים. מאמין לאנשים. מתנצל אם חושד.",
};

function model() {
  const key = process.env.OPENAI_API_KEY;
  if (key) return createOpenAI({ apiKey: key })(MINI);
  return `openai/${MINI}` as const;
}

function publicLines(state: GameState, n = 8) {
  return state.messages
    .filter((m) => m.channel === "public")
    .slice(-n)
    .map((m) => (m.narrator ? `* ${m.text}` : `${m.authorName}: ${m.text}`))
    .join("\n");
}

function tally(state: GameState) {
  const counts: Record<string, number> = {};
  for (const [vid, tid] of Object.entries(state.votes)) {
    const v = state.players.find((p) => p.id === vid);
    if (!v?.alive) continue;
    counts[tid] = (counts[tid] ?? 0) + 1;
  }
  return state.players
    .filter((p) => p.alive)
    .map((p) => `${p.name}:${counts[p.id] ?? 0}`)
    .join(" ");
}

function privateBits(state: GameState, me: Player) {
  const mem = state.memories[me.id];
  const bits: string[] = [];
  if (me.role === "wolf") {
    const pack = state.players.filter((p) => p.role === "wolf" && p.id !== me.id).map((p) => p.name);
    bits.push(`חבילה: ${pack.join(", ") || "לבד"}`);
  }
  if (me.role === "seer" && mem) {
    const known = Object.entries(mem.known).map(([id, k]) => {
      const n = state.players.find((p) => p.id === id)?.name ?? id;
      return `${n}=${k === "wolf" ? "זאב" : "לא זאב"}`;
    });
    if (known.length) bits.push(`בדקתי: ${known.join(", ")}`);
  }
  return bits.join(". ");
}

function clean(raw: string): string | null {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^["'«»]+|["'«»]+$/g, "");
  t = t.replace(/^(שם השחקן|אני אומר|תגובה)\s*[:\-–]\s*/i, "");
  if (!t || t.length < 1) return null;
  if (t.length > 140) t = t.slice(0, 137) + "…";
  const low = t.toLowerCase();
  if (/(אני (בוט|ai|סוכן|מודל)|language model|as an ai)/i.test(low)) return null;
  return t;
}

export async function generateAgentLine(opts: {
  state: GameState;
  me: Player;
  channel: "public" | "wolves";
}): Promise<string | null> {
  const { state, me, channel } = opts;
  const living = state.players.filter((p) => p.alive).map((p) => p.name).join(", ");
  const dead = state.players.filter((p) => !p.alive).map((p) => `${p.name} (${ROLE_HE[p.role]})`).join(", ");
  const sys = [
    "אתה שחקן במאפיה בקבוצת וואטסאפ ישראלית.",
    "הודעה אחת, כמו מהטלפון. עד 12 מילים. משפט שבור מותר.",
    "אסור לשון גבוהה, אסור שירה, אסור אנגלית, אסור להודות שאתה בוט.",
    "אל תכתוב 'אני בוחר לשמור על שקט'. אל תמציא שמות.",
    PERSONA[me.personality],
    `השם שלך: ${me.name}.`,
    `התפקיד הסודי שלך: ${ROLE_HE[me.role]}. אל תודה בזה אלא אם אתה זאב בחדר הזאבים.`,
  ].join("\n");

  const user = [
    `יום ${state.dayNumber}. ${channel === "wolves" ? "חדר זאבים" : "הצ'אט"}.`,
    `חיים: ${living}`,
    dead ? `מתים: ${dead}` : "",
    `הצבעה חיה: ${tally(state) || "עדיין אין"}`,
    state.lastKill?.saved ? "הלילה ההרג נכשל." : state.lastKill?.name ? `הבוקר מת: ${state.lastKill.name}` : "",
    privateBits(state, me),
    me.cannotVote ? "אסור לך להצביע היום." : "",
    "צ'אט אחרון:",
    publicLines(state) || "(שקט)",
    channel === "wolves"
      ? "תגיד משפט קצר לחבילה על מי להרוג. בלי סימן סודי מוזר."
      : "כתוב הודעה אחת לקבוצה, כאילו שלחת עכשיו מהטלפון. בלי שם בהתחלה.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const ctrl = AbortSignal.timeout(8000);
    const { text } = await generateText({
      model: model(),
      system: sys,
      prompt: user,
      maxOutputTokens: 48,
      temperature: 0.95,
      abortSignal: ctrl,
    });
    return clean(text);
  } catch {
    return null;
  }
}

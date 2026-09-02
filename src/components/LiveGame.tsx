"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ChatMessage, Gender, LiveView, Phase } from "@/lib/types";
import { ROLE_ART, ROLE_HE } from "@/lib/types";

type Tab = "village" | "role" | "people" | "me";
type StoredMe = { playerId: string; secret: string; fakeName: string };

const AVATAR = ["#e8a87c", "#7dcea0", "#f7dc6f", "#85c1e9", "#d7bde2", "#76d7c4", "#f5b7b1", "#aed6f1"];
const TZ = "Asia/Jerusalem";

function colorFor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % AVATAR.length;
  return AVATAR[n]!;
}
function initial(name: string) {
  return name.trim().slice(0, 1) || "?";
}

function loadMe(code: string): StoredMe | null {
  try {
    const raw = localStorage.getItem(`mafia-live:${code}`);
    return raw ? (JSON.parse(raw) as StoredMe) : null;
  } catch {
    return null;
  }
}
function saveMe(code: string, me: StoredMe) {
  try {
    localStorage.setItem(`mafia-live:${code}`, JSON.stringify(me));
  } catch {
    /* ignore */
  }
}
function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

function fmtRemain(ms: number): string {
  if (ms <= 0) return "0";
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  if (m > 0) return `${m}:${r.toString().padStart(2, "0")}`;
  return `${r}`;
}

const timeFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabelFmt = new Intl.DateTimeFormat("he-IL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

function fmtTime(ts: number) {
  return timeFmt.format(new Date(ts));
}

function phaseHint(view: LiveView): string {
  if (view.waitText) return view.waitText;
  switch (view.phase) {
    case "lobby":
      return "מחכים שהמנהל יתחיל";
    case "day":
      return "מדברים, אחר כך מצביעים";
    case "night_wolves":
      return "הזאבים בוחרים";
    case "night_seer":
      return "הרואה בודק";
    case "night_doctor":
      return "הרופא שומר";
    case "ended":
      return "נגמר";
    case "wait":
      return "היום סגור";
    default:
      return view.phaseLabel;
  }
}

function phaseToast(view: LiveView): string | null {
  switch (view.phase) {
    case "day":
      return `☀ יום ${view.dayNumber}. מדברים, אחר כך מצביעים.`;
    case "night_wolves":
      return view.me.role === "wolf" && view.me.alive ? "🌙 לילה. התור שלך: בחר מי מת." : "🌙 לילה. הכפר נסגר.";
    case "night_seer":
      return view.me.role === "seer" && view.me.alive ? "🔮 הלילה שלך. בחר מי לבדוק." : null;
    case "night_doctor":
      return view.me.role === "doctor" && view.me.alive ? "🩺 הלילה שלך. בחר על מי לשמור." : null;
    case "ended":
      return view.winnerText || "המשחק נגמר";
    default:
      return null;
  }
}

function roleMission(role: LiveView["me"]["role"], gender: Gender, pack: string[]): string {
  const f = gender === "f";
  switch (role) {
    case "wolf":
      return `${f ? "את זאבה" : "אתה זאב"}. ביום ${f ? "את תושבת תמימה" : "אתה תושב תמים"}, בלילה ${f ? "את והחבילה בוחרות" : "אתה והחבילה בוחרים"} מי לא יתעורר.${
        pack.length ? ` החבילה שלך: ${pack.join(", ")}.` : " הפעם לבד."
      }`;
    case "seer":
      return `${f ? "את הרואה" : "אתה הרואה"}. כל לילה ${f ? "את בודקת" : "אתה בודק"} אחד: זאב או לא. מה לעשות עם המידע, זה כבר עליך.`;
    case "doctor":
      return `${f ? "את הרופאה" : "אתה הרופא"}. כל לילה ${f ? "את שומרת" : "אתה שומר"} על אחד, גם על עצמך. אף אחד לא יודע, אלא אם תספרו.`;
    case "villager":
      return `${f ? "את תושבת" : "אתה תושב"}. אין לך כוח בלילה, יש לך עיניים ביום. ${f ? "תקראי" : "תקרא"} מי מדבר, מי שותק, ומי מצביע אחרון.`;
    default:
      return "";
  }
}

function nightReminder(role: LiveView["me"]["role"], gender: Gender): string {
  const f = gender === "f";
  switch (role) {
    case "wolf":
      return f ? "בלילה את והחבילה בוחרות מי מת. ביום משקרות יפה." : "בלילה אתה והחבילה בוחרים מי מת. ביום משקרים יפה.";
    case "seer":
      return f ? "בלילה את בודקת אחד. זאב או לא. ביום מדברים." : "בלילה אתה בודק אחד. זאב או לא. ביום מדברים.";
    case "doctor":
      return f ? "בלילה את שומרת על אחד. גם על עצמך אפשר." : "בלילה אתה שומר על אחד. גם על עצמך אפשר.";
    case "villager":
      return "ביום מדברים ומצביעים. אין לך פעולה בלילה, אבל יש לך עיניים.";
    default:
      return "עוד אין תפקיד. מחכים שיתחילו.";
  }
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function liveApi(body: Record<string, unknown>) {
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    game?: LiveView;
    me?: StoredMe;
    needsAuth?: boolean;
  };
  if (!res.ok) throw new ApiError(data.error ?? "לא הלך", res.status);
  return data;
}

export default function LiveGame({ code }: { code: string }) {
  const [view, setView] = useState<LiveView | null>(null);
  const [identity, setIdentity] = useState<StoredMe | null>(null);
  const [realName, setRealName] = useState("");
  const [gender, setGender] = useState<Gender>("m");
  const [tab, setTab] = useState<Tab>("village");
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [seenPublic, setSeenPublic] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  const [shared, setShared] = useState(false);
  const failures = useRef(0);
  const lastPhase = useRef<Phase | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const publicEnd = useRef<HTMLDivElement>(null);
  const messageInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = loadMe(code);
    if (stored) {
      setIdentity(stored);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/live?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const data = (await res.json()) as { game?: LiveView };
        if (data.game?.me) {
          setIdentity({ playerId: data.game.me.playerId, secret: "", fakeName: data.game.me.fakeName });
          setView(data.game);
        }
      } catch {
        /* join form */
      }
    })();
  }, [code]);

  const applyView = useCallback((game: LiveView) => {
    // Never let a slow poll overwrite a newer message list with an older one.
    setView((current) => {
      if (current && current.messages.length > game.messages.length && current.phase === game.phase) {
        const optimistic = current.messages.filter((m) => m.id.startsWith("tmp-"));
        return { ...game, messages: [...game.messages, ...optimistic] };
      }
      return game;
    });
  }, []);

  const refresh = useCallback(async () => {
    const me = identity ?? loadMe(code);
    if (!me) return;
    try {
      const data = await liveApi({ action: "get", code, secret: me.secret });
      if (data.game) applyView(data.game);
      failures.current = 0;
      setErr(null);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) return;
      failures.current += 1;
      if (failures.current >= 3 || status === 401 || status === 404) {
        setErr(e instanceof Error ? e.message : "לא הלך");
      }
    }
  }, [code, identity, applyView]);

  useEffect(() => {
    if (!identity) return;
    void refresh();
  }, [identity, refresh]);

  useEffect(() => {
    if (!identity) return;
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      // Background tabs keep the game moving too, just five times slower.
      if (typeof document !== "undefined" && document.visibilityState === "hidden" && ticks % 5 !== 0) return;
      void refresh();
    };
    const id = setInterval(tick, 2000);
    const vis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [identity, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const publicCount = view?.messages.filter((m) => m.channel === "public").length ?? 0;
  const lastMessage = view?.messages[view.messages.length - 1];
  const lastIsMine = lastMessage?.authorId === view?.me.playerId;

  // Follow the conversation only when the reader is already at the bottom or just wrote something.
  useEffect(() => {
    if (tab !== "village" && tab !== "role") return;
    if (atBottom || lastIsMine) publicEnd.current?.scrollIntoView({ block: "end" });
    if (tab === "village" && atBottom) setSeenPublic(publicCount);
  }, [publicCount, view?.messages.length, view?.typing.length, tab, atBottom, lastIsMine]);

  useEffect(() => {
    if (tab === "village" || tab === "role") requestAnimationFrame(() => publicEnd.current?.scrollIntoView({ block: "end" }));
  }, [tab]);

  useEffect(() => {
    if (view?.me.canNightPick) setTab("role");
  }, [view?.me.canNightPick, view?.phase]);

  // Phase changes get a short banner. The very first load does not.
  useEffect(() => {
    if (!view) return;
    const phase = view.phase;
    if (lastPhase.current === null) {
      lastPhase.current = phase;
      return;
    }
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    const text = phaseToast(view);
    if (!text) return;
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(30);
      } catch {
        /* not supported */
      }
    }
  }, [view?.phase, view]);

  // Dramatic role reveal, once per game.
  useEffect(() => {
    if (!view || view.status !== "running" || !view.me.role) return;
    if (flag(`mafia-live:${code}:reveal`)) return;
    setShowReveal(true);
  }, [view?.status, view?.me.role, view, code]);

  function dismissReveal() {
    setFlag(`mafia-live:${code}:reveal`);
    setShowReveal(false);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const data = await liveApi({ action: "join", code, realName: realName.trim(), gender });
      if (data.me) {
        saveMe(code, data.me);
        setIdentity(data.me);
      }
      if (data.game) setView(data.game);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    }
  }

  async function startGame() {
    if (!identity || starting) return;
    setStarting(true);
    setErr(null);
    try {
      const data = await liveApi({ action: "start", code, secret: identity.secret });
      if (data.game) setView(data.game);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    if (!identity || !view || !text.trim() || sending) return;
    const t = text.trim();
    const tempId = `tmp-${Date.now()}`;
    const channel = tab === "role" ? "wolves" : "public";
    setText("");
    setSending(true);
    // Show the line at once; the server's copy replaces it on the next view.
    setView((current) =>
      current
        ? {
            ...current,
            messages: [...current.messages, { id: tempId, channel, authorId: current.me.playerId, authorName: current.me.fakeName, text: t, ts: Date.now() }],
          }
        : current,
    );
    try {
      const data = await liveApi({ action: "say", code, secret: identity.secret, text: t });
      if (data.game) setView(data.game);
      setErr(null);
    } catch (er) {
      setView((current) => (current ? { ...current, messages: current.messages.filter((m) => m.id !== tempId) } : current));
      setText(t);
      setErr(er instanceof Error ? er.message : "לא הלך");
    } finally {
      setSending(false);
      requestAnimationFrame(() => messageInput.current?.focus());
    }
  }

  function address(name: string) {
    setText((current) => {
      const body = current.replace(/^@?[\p{L}\p{N}]+[,،:]?\s*/u, "").trimStart();
      return `${name}, ${body}`;
    });
    requestAnimationFrame(() => messageInput.current?.focus());
  }

  async function vote(targetId: string) {
    if (!identity) return;
    try {
      const data = await liveApi({ action: "vote", code, secret: identity.secret, targetId });
      if (data.game) setView(data.game);
      setErr(null);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    }
  }

  async function nightPick(targetId: string) {
    if (!identity) return;
    try {
      const data = await liveApi({ action: "nightPick", code, secret: identity.secret, targetId });
      if (data.game) setView(data.game);
      setErr(null);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    }
  }

  async function share() {
    const url = `${window.location.origin}/g/${code}`;
    const payload = { title: "מאפיה", text: `בואו לשחק מאפיה. הקוד ${code}`, url };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await navigator.clipboard.writeText(`${payload.text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 1500);
      }
    } catch {
      /* user closed the sheet */
    }
  }

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  function jumpToBottom() {
    publicEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setAtBottom(true);
    setSeenPublic(publicCount);
  }

  const left = view?.nextLockAt ? Math.max(0, new Date(view.nextLockAt).getTime() - now) : 0;
  const night = Boolean(view?.phase.startsWith("night"));

  if (!identity) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-night px-4 py-8 text-paper">
        <Link href="/play" className="text-sm text-dust">
          ← חזרה
        </Link>
        <h1 className="mt-8 text-3xl font-extrabold">נכנסים</h1>
        <p className="mt-2 text-dust">קוד {code}. השם האמיתי נשאר אצלך אם המנהל בחר שמות בדויים.</p>
        <form onSubmit={(e) => void join(e)} className="mt-8 space-y-3">
          <input
            className="min-h-12 w-full rounded-2xl bg-white/10 px-4 text-paper"
            placeholder="השם שלך"
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
            maxLength={24}
          />
          <GenderToggle value={gender} onChange={setGender} />
          <button className="min-h-14 w-full rounded-2xl bg-paper text-lg font-extrabold text-ink disabled:opacity-40" disabled={!realName.trim()}>
            הכנס
          </button>
        </form>
        {err && <p className="mt-4 text-sm text-red-300">{err}</p>}
      </div>
    );
  }

  if (!view) {
    return <div className="flex min-h-dvh items-center justify-center bg-night text-lg text-paper">טוען…</div>;
  }

  if (view.status === "lobby") {
    const quick = view.rules.mode === "quick";
    const humansOnlyNeedsMore = view.rules.botMode === "humans_only" && view.humansJoined < view.rules.seats;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-night px-4 py-6 text-paper">
        <div className="flex items-center justify-between text-sm text-dust">
          <span>לובי · {view.humansJoined}/{view.seats}</span>
          {view.me.isHost && (
            <Link href={`/admin/${code}`} className="text-dust underline-offset-4 hover:underline">
              ניהול
            </Link>
          )}
        </div>
        <h1 className="mt-2 text-3xl font-extrabold">{view.me.isHost ? "השולחן שלך" : "מחכים שהמנהל יתחיל"}</h1>
        <div className="mt-3 flex items-center gap-3">
          <div className="rounded-2xl bg-white/5 px-4 py-2 font-mono text-2xl font-black tracking-[.3em]">{view.code}</div>
          <button type="button" onClick={() => void share()} className="min-h-12 flex-1 rounded-2xl bg-paper font-extrabold text-ink">
            {shared ? "הועתק" : "שתפו את הקוד"}
          </button>
        </div>
        <ul className="mt-6 space-y-2">
          {view.players.map((p) => (
            <li key={p.id} className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/5 px-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-ink" style={{ background: colorFor(p.id) }}>
                {initial(p.name)}
              </span>
              <span className="font-bold">{p.name}</span>
              {p.isMe && (
                <span className="text-xs text-dust">
                  {view.me.gender === "f" ? "את" : "אתה"} · {view.me.realName}
                </span>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(0, view.seats - view.players.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="flex min-h-12 items-center gap-3 rounded-2xl border border-dashed border-white/10 px-3 text-sm text-dust">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10">?</span>
              {view.rules.botMode === "fill" ? "פנוי · יתמלא בשחקן AI" : "פנוי"}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-dust">
          {quick
            ? `משחק מהיר: יום של ${view.rules.quickDayMinutes} דקות, לילה של ${view.rules.quickNightMinutes} דקות. הכל בישיבה אחת.`
            : `משחק מתמשך: ביום ${view.schedule.dayStart}–${view.schedule.dayEnd}, ימים ${view.schedule.days.map((d) => ["א", "ב", "ג", "ד", "ה", "ו", "ש"][d]).join(" ")}. בלילה בעלי התפקידים פועלים.`}{" "}
          {view.rules.wolfCount} זאבים.
        </p>
        <div className="mt-auto space-y-3 pt-8">
          {view.me.isHost ? (
            <button
              type="button"
              onClick={() => void startGame()}
              disabled={starting || humansOnlyNeedsMore}
              className="min-h-14 w-full rounded-2xl bg-ember text-lg font-extrabold text-white disabled:opacity-40"
            >
              {starting
                ? "מחלקים תפקידים…"
                : humansOnlyNeedsMore
                  ? `מחכים לעוד ${view.rules.seats - view.humansJoined}`
                  : view.rules.botMode === "fill" && view.players.length < view.seats
                    ? "להתחיל, ה-AI ישלים את השולחן"
                    : "להתחיל"}
            </button>
          ) : (
            <div className="min-h-12 rounded-2xl bg-white/5 text-center leading-[3rem] text-dust">מחכים שהמנהל יתחיל</div>
          )}
          {err && <p className="text-center text-sm text-red-300">{err}</p>}
        </div>
      </div>
    );
  }

  const aliveCount = view.players.filter((p) => p.alive).length;
  const majorityNeed = Math.floor(aliveCount / 2) + 1;
  const roleChannel = view.me.role === "wolf" ? "wolves" : view.me.role === "seer" ? "seer" : view.me.role === "doctor" ? "doctor" : null;
  const activeChannel = tab === "role" ? roleChannel : "public";
  const roleChannelLabel = view.me.role === "wolf" ? "ערוץ הזאבים" : view.me.role === "seer" ? "יומן הרואה" : view.me.role === "doctor" ? "יומן הרופא" : "אין לך ערוץ פרטי";
  const roleChannelHint = view.me.role === "wolf" ? "רק חברי הלהקה רואים וכותבים כאן בלילה" : view.me.role === "seer" ? "רק תוצאות הבדיקות שלך מופיעות כאן" : view.me.role === "doctor" ? "רק בחירות השמירה שלך מופיעות כאן" : "לתושבים אין שיחת לילה פרטית";
  const canCompose = view.me.canSpeak && ((tab === "village" && view.phase === "day") || (tab === "role" && view.phase === "night_wolves" && view.me.role === "wolf"));
  const typingHere =
    (tab === "village" && view.phase === "day") || (tab === "role" && view.phase === "night_wolves" && view.me.role === "wolf") ? view.typing : [];
  const unread = Math.max(0, publicCount - seenPublic);
  const leader = view.phase === "day" ? [...view.players].filter((p) => p.alive && p.votes > 0).sort((a, b) => b.votes - a.votes)[0] : undefined;
  const myVoteName = view.me.myVote ? view.players.find((p) => p.id === view.me.myVote)?.name ?? null : null;

  return (
    <div className={`flex h-dvh flex-col overflow-hidden text-paper ${night ? "bg-[#07060a]" : "bg-night"}`}>
      {showReveal && view.me.role && (
        <RoleReveal
          role={view.me.role}
          name={view.me.fakeName}
          gender={view.me.gender}
          pack={view.me.pack}
          aliases={view.rules.identityMode === "aliases"}
          onClose={dismissReveal}
        />
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4">
          <div className="phase-toast rounded-2xl border border-white/15 bg-black/85 px-4 py-3 text-center text-sm font-bold shadow-2xl backdrop-blur">{toast}</div>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-extrabold leading-tight">{night ? "🌙 " : ""}מאפיה</div>
            <div className="truncate text-xs text-dust">
              {view.dayNumber ? `יום ${view.dayNumber} · ` : ""}
              {phaseHint(view)}
            </div>
          </div>
          {view.status === "running" && view.nextLockAt && (
            <div className={`flex h-11 min-w-11 flex-col items-center justify-center rounded-full px-3 ${left < 10 * 60_000 && view.phase === "day" ? "bg-ember" : "bg-blood"}`}>
              <div className="text-base font-extrabold tabular-nums leading-none">{fmtRemain(left)}</div>
            </div>
          )}
          {view.me.isHost && (
            <Link href={`/admin/${code}`} className="text-xs text-dust underline-offset-4 hover:underline">
              ניהול
            </Link>
          )}
          <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm" aria-label="בית">
            ⌂
          </Link>
        </div>
        {view.nextLockPretty && view.status === "running" && view.rules.mode !== "quick" && (
          <div className="mx-auto max-w-lg pt-1 text-center text-[11px] text-dust">נעילה {view.nextLockPretty}</div>
        )}
      </header>

      {view.winner && (
        <div className="bg-blood px-4 py-3 text-center">
          <div className="text-lg font-extrabold">{view.winnerText}</div>
          <div className="mt-1 text-xs text-paper/80">כל הקלפים נחשפו בלשונית השחקנים.</div>
        </div>
      )}
      {!view.me.alive && view.status !== "ended" && (
        <div className="bg-black px-4 py-3 text-center text-sm">
          {view.me.gender === "f" ? "מתת. היית" : "מתת. היית"} {view.me.role ? ROLE_HE[view.me.role] : "?"}. אפשר לקרוא, לא לכתוב.
        </div>
      )}
      {view.waitText && <div className="bg-white/5 px-4 py-2 text-center text-sm text-dust">{view.waitText}</div>}

      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
        <div className={`min-h-0 flex-1 ${tab === "village" || tab === "role" ? "flex" : "hidden"}`}>
          <div className="relative flex min-h-0 w-full flex-1 flex-col">
            {tab === "role" && (
              <div className="border-b border-white/10 bg-blood/15 px-4 py-3">
                <div className="font-extrabold">{roleChannelLabel}</div>
                <div className="mt-0.5 text-xs text-dust">{roleChannelHint}</div>
                {view.me.canNightPick && (
                  <button type="button" onClick={() => setTab("people")} className="mt-2 rounded-full bg-paper px-3 py-1.5 text-xs font-black text-ink">
                    {view.me.nightAction === "wolf" ? "בחירת קורבן" : view.me.nightAction === "seer" ? "בחירת בדיקה" : "בחירת שמירה"}
                  </button>
                )}
              </div>
            )}
            <div ref={scroller} onScroll={onScroll} className="chat-scroll min-h-0 flex-1 space-y-2 px-3 py-3">
              <MessageList messages={view.messages.filter((m) => m.channel === activeChannel)} myId={view.me.playerId} />
              {typingHere.length > 0 && <Typing names={typingHere} players={view.players} />}
              <div ref={publicEnd} />
            </div>
            {!atBottom && unread > 0 && tab === "village" && (
              <button
                type="button"
                onClick={jumpToBottom}
                className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full bg-paper px-4 py-2 text-xs font-black text-ink shadow-xl"
              >
                ↓ {unread} הודעות חדשות
              </button>
            )}
            {view.phase === "day" && view.me.alive && tab === "village" && view.status === "running" && (
              <button
                type="button"
                onClick={() => setTab("people")}
                className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[.04] px-4 py-2 text-xs"
              >
                <span className={myVoteName ? "text-paper" : "text-ember"}>
                  {view.me.cannotVote ? "אין לך הצבעה היום" : myVoteName ? `ההצבעה שלך: ${myVoteName}` : "עוד לא הצבעת"}
                </span>
                <span className="text-dust">
                  {leader ? `${leader.name} ${leader.gender === "f" ? "מובילה" : "מוביל"} ${leader.votes}/${majorityNeed}` : `אין עוד קולות · צריך ${majorityNeed}`} · להצבעה ←
                </span>
              </button>
            )}
            {canCompose ? (
              <div className="border-t border-white/10">
                {tab === "village" && view.phase === "day" && (
                  <div className="chat-scroll flex items-center gap-1.5 overflow-x-auto px-3 pb-1 pt-2" aria-label="פנייה מהירה לשחקן">
                    <span className="shrink-0 text-[11px] text-dust">לפנות אל</span>
                    {view.players
                      .filter((player) => player.alive && !player.isMe)
                      .map((player) => (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => address(player.name)}
                          className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-paper/65 hover:bg-white/10 hover:text-paper"
                        >
                          {player.name}
                        </button>
                      ))}
                  </div>
                )}
                <form
                  className="flex gap-2 px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <input
                    ref={messageInput}
                    className="min-h-12 min-w-0 flex-1 rounded-2xl bg-white/10 px-4 text-paper"
                    placeholder={tab === "role" ? "לחבילה…" : "כתבו שם בתחילת ההודעה כדי לפנות אליו"}
                    value={text}
                    maxLength={240}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    aria-label="הודעה"
                    enterKeyHint="send"
                  />
                  <button disabled={sending || !text.trim()} className="min-h-12 rounded-2xl bg-paper px-4 font-extrabold text-ink disabled:opacity-40">
                    שלח
                  </button>
                </form>
              </div>
            ) : (
              <div className="border-t border-white/10 px-3 py-3 text-center text-xs text-dust">
                {view.status === "ended"
                  ? "המשחק נגמר. תודה ששיחקתם."
                  : view.me.alive
                    ? tab === "role"
                      ? "הערוץ ייפתח כשיגיע שלב התפקיד שלך"
                      : night
                        ? "לילה. הכפר ישן, בעלי התפקידים עובדים."
                        : "כיכר הכפר סגורה עכשיו"
                    : "רק קריאה"}
              </div>
            )}
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "people" ? "block" : "hidden"}`}>
          <div className="mb-3 flex items-baseline justify-between text-sm text-dust">
            <span>
              {view.status === "ended"
                ? "הקלפים על השולחן"
                : view.me.canVote
                  ? `הצבעה. צריך ${majorityNeed} לרוב. לחיצה על שם מצביעה.`
                  : view.me.canNightPick
                    ? view.me.nightAction === "wolf"
                      ? "בחר מי מת הלילה"
                      : view.me.nightAction === "seer"
                        ? "בחר מי לבדוק"
                        : "בחר על מי לשמור"
                    : view.phase === "day"
                      ? `הצבעה. צריך ${majorityNeed} לרוב`
                      : "עכשיו בלי פעולה"}
            </span>
            {leader && view.phase === "day" && (
              <span className="text-xs">
                {leader.name} {leader.gender === "f" ? "מובילה" : "מוביל"} · {leader.votes}/{majorityNeed}
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {view.players.map((p) => {
              const pickedVote = view.me.myVote === p.id;
              const pickedNight = view.me.myNightPick === p.id;
              const packBlock = view.me.nightAction === "wolf" && (p.isMe || view.me.pack.includes(p.name));
              const tappable =
                view.status !== "ended" &&
                ((view.me.canVote && p.alive) || (view.me.canNightPick && p.alive && !packBlock && !(view.me.nightAction === "seer" && p.isMe)));
              const ratio = view.phase === "day" && p.alive ? Math.min(1, p.votes / majorityNeed) : 0;
              return (
                <li key={p.id}>
                  <button
                    disabled={!tappable}
                    onClick={() => {
                      if (view.me.canVote) void vote(p.id);
                      else if (view.me.canNightPick) void nightPick(p.id);
                    }}
                    className={`relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-right transition active:scale-[.99] ${
                      p.alive ? "bg-white/5" : "bg-black/30 opacity-60"
                    } ${pickedVote || pickedNight ? "ring-2 ring-paper" : ""}`}
                  >
                    {ratio > 0 && (
                      <span aria-hidden="true" className={`absolute inset-y-0 right-0 ${ratio >= 1 ? "bg-ember/35" : "bg-blood/30"}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
                    )}
                    {p.alive && !p.role ? (
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-ink" style={{ background: colorFor(p.id) }}>
                        {initial(p.name)}
                      </div>
                    ) : (
                      <img src={p.role ? ROLE_ART[p.role] : "/art/villager.png"} alt="" className="relative h-11 w-11 shrink-0 rounded-full object-cover" />
                    )}
                    <div className="relative min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate font-bold ${p.alive ? "" : "line-through"}`}>
                          {p.name}
                          {p.isMe ? (view.me.gender === "f" ? " · את" : " · אתה") : ""}
                        </span>
                        {view.phase === "day" && p.alive && <span className="tabular-nums text-lg font-extrabold">{p.votes}</span>}
                      </div>
                      {p.voters.length ? <div className="mt-1 truncate text-xs text-dust">{p.voters.join(", ")}</div> : null}
                      {p.role && (p.isMe || !p.alive || view.status === "ended") && (
                        <div className="text-xs text-dust">
                          {p.alive ? "" : "מת · "}
                          {ROLE_HE[p.role]}
                        </div>
                      )}
                      {pickedVote && <div className="text-xs text-paper/80">ההצבעה שלך</div>}
                      {pickedNight && <div className="text-xs text-paper/80">הבחירה שלך</div>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {view.status === "ended" && (
            <Link href="/admin" className="mt-6 flex min-h-12 items-center justify-center rounded-2xl bg-paper font-extrabold text-ink">
              לפתוח שולחן חדש
            </Link>
          )}
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "me" ? "block" : "hidden"}`}>
          <MePane view={view} onReveal={() => setShowReveal(true)} />
        </div>
      </div>

      {err && <div className="px-4 pb-2 text-center text-sm text-red-300">{err}</div>}

      <nav className="sticky bottom-0 z-20 border-t border-white/10 bg-black/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {(
            [
              ["village", "כפר"],
              ["role", roleChannel ? "תפקיד •" : "תפקיד"],
              ["people", view.phase === "day" && view.me.canVote && !view.me.myVote ? "הצבעה !" : "שחקנים"],
              ["me", "אני"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`relative min-h-14 text-sm font-bold ${tab === id ? "text-paper" : "text-dust"}`} onClick={() => setTab(id)}>
              {label}
              {id === "village" && unread > 0 && tab !== "village" && (
                <span className="absolute right-1/2 top-2 translate-x-6 rounded-full bg-ember px-1.5 text-[10px] font-black text-white">{unread}</span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function RoleReveal({
  role,
  name,
  gender,
  pack,
  aliases,
  onClose,
}: {
  role: NonNullable<LiveView["me"]["role"]>;
  name: string;
  gender: Gender;
  pack: string[];
  aliases: boolean;
  onClose: () => void;
}) {
  const f = gender === "f";
  const title = role === "wolf" ? (f ? "זאבה" : "זאב") : role === "seer" ? (f ? "רואה" : "רואה") : role === "doctor" ? (f ? "רופאה" : "רופא") : f ? "תושבת" : "תושב";
  return (
    <div className="role-reveal fixed inset-0 z-50 overflow-y-auto bg-black text-paper">
      <img src={ROLE_ART[role]} alt="" className="fixed inset-0 h-full w-full object-cover opacity-70" />
      <div className="fixed inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
      <div className="relative flex min-h-full flex-col justify-end px-6 pb-8 pt-40 sm:pb-10">
        <div className="text-sm font-bold text-ember">{aliases ? `בכפר קוראים לך ${name}` : name}</div>
        <h1 className="mt-2 text-5xl font-black leading-none sm:text-6xl">{title}</h1>
        <p className="mt-3 max-w-md text-base leading-7 text-paper/85 sm:text-lg sm:leading-8">{roleMission(role, gender, pack)}</p>
        <p className="mt-2 text-xs text-paper/50 sm:text-sm">התפקיד סודי. הלשונית "אני" תזכיר לך אותו בכל רגע.</p>
        <button type="button" onClick={onClose} className="mt-5 min-h-14 w-full rounded-2xl bg-paper text-lg font-extrabold text-ink">
          {role === "wolf" ? "לחייך ולהיכנס לכפר" : "להיכנס לכפר"}
        </button>
      </div>
    </div>
  );
}

function GenderToggle({ value, onChange }: { value: Gender; onChange: (value: Gender) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="איך לפנות אליך">
      {(
        [
          ["m", "אליי פונים בזכר"],
          ["f", "אליי פונים בנקבה"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`min-h-11 rounded-2xl border text-sm font-bold ${value === id ? "border-paper/60 bg-paper/10 text-paper" : "border-white/10 bg-white/5 text-dust"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Typing({ names, players }: { names: string[]; players: LiveView["players"] }) {
  const genderOf = (name: string) => players.find((p) => p.name === name)?.gender ?? "m";
  const allF = names.every((n) => genderOf(n) === "f");
  const label =
    names.length === 1
      ? `${names[0]} ${genderOf(names[0]!) === "f" ? "כותבת" : "כותב"}…`
      : names.length === 2
        ? `${names[0]} ו${names[1]} ${allF ? "כותבות" : "כותבים"}…`
        : `${names.length} ${allF ? "כותבות" : "כותבים"}…`;
  return (
    <div className="flex items-center gap-2 px-1 pt-1 text-xs text-dust">
      <span className="typing-dots inline-flex gap-0.5" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </div>
  );
}

function MessageList({ messages, myId }: { messages: ChatMessage[]; myId: string }) {
  const items = useMemo(() => {
    const out: { key: string; separator?: string; message?: ChatMessage; continued?: boolean }[] = [];
    let lastDay = "";
    let prev: ChatMessage | null = null;
    for (const m of messages) {
      const day = dayKeyFmt.format(new Date(m.ts));
      if (day !== lastDay) {
        lastDay = day;
        out.push({ key: `sep-${day}`, separator: dayLabelFmt.format(new Date(m.ts)) });
        prev = null;
      }
      const continued = Boolean(prev && !prev.narrator && !m.narrator && prev.authorId === m.authorId && m.ts - prev.ts < 3 * 60_000 && !m.replyToId);
      out.push({ key: m.id, message: m, continued });
      prev = m;
    }
    return out;
  }, [messages]);

  return (
    <>
      {items.map((item) => {
        if (item.separator) {
          return (
            <div key={item.key} className="flex items-center gap-3 py-2 text-[11px] text-dust/70">
              <span className="h-px flex-1 bg-white/10" />
              <span>{item.separator}</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
          );
        }
        const m = item.message!;
        const repliedTo = m.replyToId ? messages.find((candidate) => candidate.id === m.replyToId) : null;
        if (m.narrator) {
          const tone = m.tone;
          const cls =
            tone === "recap"
              ? "border border-white/10 bg-white/[.06] text-paper"
              : tone === "alert"
                ? "border border-ember/40 bg-ember/15 text-paper"
                : tone === "director"
                  ? "border border-ember/20 bg-ember/10 text-paper/90"
                  : tone === "reveal"
                    ? "border border-paper/30 bg-paper/10 text-paper"
                    : "bg-white/5 text-dust";
          return (
            <div key={item.key} className={`mx-auto my-2 max-w-[92%] rounded-2xl px-4 py-2 text-center text-sm ${cls}`}>
              <div>{m.text}</div>
              <div className="mt-0.5 text-[10px] opacity-50">{fmtTime(m.ts)}</div>
            </div>
          );
        }
        const mine = m.authorId === myId;
        const pending = m.id.startsWith("tmp-");
        return (
          <div key={item.key} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""} ${item.continued ? "mt-0.5" : "mt-2"}`}>
            {item.continued ? (
              <div className="w-9 shrink-0" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-ink" style={{ background: colorFor(m.authorId ?? m.authorName) }}>
                {initial(m.authorName)}
              </div>
            )}
            <div className={`min-w-0 max-w-[85%] ${mine ? "text-left" : ""}`}>
              {!item.continued && (
                <div className="mb-0.5 flex items-baseline gap-2 text-xs text-dust">
                  <span style={{ color: colorFor(m.authorId ?? m.authorName) }}>{mine ? "אני" : m.authorName}</span>
                  <span className="text-[10px] opacity-60">{fmtTime(m.ts)}</span>
                </div>
              )}
              <div
                className={`inline-block max-w-full rounded-2xl px-3 py-2 text-[15px] leading-snug ${mine ? "rounded-bl-md bg-[#3a2a22]" : "rounded-br-md bg-[#2a2420]"} ${pending ? "opacity-60" : ""}`}
              >
                {repliedTo && <div className="mb-1 border-r-2 border-ember/60 pr-2 text-[11px] text-paper/45">בתגובה ל{repliedTo.authorName}</div>}
                {m.text}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function MePane({ view, onReveal }: { view: LiveView; onReveal: () => void }) {
  const role = view.me.role;
  const art = role ? ROLE_ART[role] : "/art/villager.png";
  return (
    <div className="space-y-3 pb-6">
      <button type="button" onClick={onReveal} className="block w-full overflow-hidden rounded-3xl bg-white/5 text-right">
        <img src={art} alt="" className="aspect-[4/5] w-full object-cover" />
        <div className="p-4">
          <div className="text-2xl font-extrabold">{view.me.fakeName}</div>
          <div className="mt-1 text-dust">
            {role ? ROLE_HE[role] : "עוד אין תפקיד"}
            {!view.me.alive ? (view.me.gender === "f" ? " · מתה" : " · מת") : ""}
          </div>
          <div className="mt-1 text-xs text-dust">
            {view.rules.identityMode === "aliases" ? `השם האמיתי שלך (רק אצלך): ${view.me.realName}` : "זה השם שמוצג בכפר"}
          </div>
        </div>
      </button>
      <div className="rounded-2xl bg-white/5 p-4 text-[15px] leading-relaxed">{nightReminder(role, view.me.gender)}</div>
      {view.me.pack.length > 0 && (
        <div className="rounded-2xl bg-white/5 p-4">
          <div className="font-extrabold">החבילה</div>
          <div className="mt-1 text-dust">{view.me.pack.join(", ")}</div>
        </div>
      )}
      {view.me.inspections.length > 0 && (
        <div className="rounded-2xl bg-white/5 p-4">
          <div className="font-extrabold">מה שבדקת</div>
          <div className="mt-2 space-y-1 text-sm text-dust">
            {view.me.inspections.map((x) => (
              <div key={x.name}>
                {x.name}: {x.result}
              </div>
            ))}
          </div>
        </div>
      )}
      {view.deaths.length > 0 && (
        <div className="rounded-2xl bg-white/5 p-4">
          <div className="mb-2 font-extrabold">מי מת</div>
          <div className="space-y-1 text-sm text-dust">
            {view.deaths.map((d, i) => (
              <div key={`${d.name}-${i}`}>{d.text}</div>
            ))}
          </div>
        </div>
      )}
      {view.directorEvents.length > 0 && (
        <div className="rounded-2xl border border-ember/20 bg-ember/10 p-4">
          <div className="mb-2 font-extrabold">מה הבמאי עשה</div>
          <div className="space-y-2 text-sm text-dust">
            {view.directorEvents.map((event) => (
              <div key={event.id}>
                <span className="font-bold text-paper">{event.title}:</span> {event.text}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-2xl bg-white/5 p-4 text-xs leading-relaxed text-dust">
        {view.rules.mode === "quick"
          ? `משחק מהיר. יום ${view.rules.quickDayMinutes} דקות, לילה ${view.rules.quickNightMinutes} דקות.`
          : `משחק מתמשך. הכפר פתוח ${view.schedule.dayStart}–${view.schedule.dayEnd}. ההודעות מסומנות בשעה שנכתבו, גם אם לא הייתם כאן.`}
      </div>
    </div>
  );
}

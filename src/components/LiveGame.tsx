"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { ChatMessage, Gender, LiveView } from "@/lib/types";
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
  const [now, setNow] = useState(() => Date.now());
  const [seenPublic, setSeenPublic] = useState(0);
  const failures = useRef(0);
  const publicEnd = useRef<HTMLDivElement>(null);
  const messageInput = useRef<HTMLInputElement>(null);

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

  const refresh = useCallback(async () => {
    const me = identity ?? loadMe(code);
    if (!me) return;
    try {
      const data = await liveApi({ action: "get", code, secret: me.secret });
      if (data.game) setView(data.game);
      failures.current = 0;
      setErr(null);
    } catch (e) {
      // A poll that lost a race or hit a hiccup is not worth a red line. Three in a row are.
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) return;
      failures.current += 1;
      if (failures.current >= 3 || status === 401 || status === 404) {
        setErr(e instanceof Error ? e.message : "לא הלך");
      }
    }
  }, [code, identity]);

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

  useEffect(() => {
    if (tab === "village" || tab === "role") publicEnd.current?.scrollIntoView({ block: "end" });
    if (tab === "village") setSeenPublic(publicCount);
  }, [publicCount, view?.typing.length, tab]);

  useEffect(() => {
    if (view?.me.canNightPick) setTab("role");
  }, [view?.me.canNightPick, view?.phase]);

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

  async function send() {
    if (!identity || !text.trim() || sending) return;
    const t = text.trim();
    setText("");
    setSending(true);
    try {
      const data = await liveApi({ action: "say", code, secret: identity.secret, text: t });
      if (data.game) setView(data.game);
      setErr(null);
    } catch (er) {
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
          <button
            className="min-h-14 w-full rounded-2xl bg-paper text-lg font-extrabold text-ink disabled:opacity-40"
            disabled={!realName.trim()}
          >
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
        <h1 className="mt-2 text-3xl font-extrabold">מחכים שהמנהל יתחיל</h1>
        <p className="mt-1 text-dust">הקוד {view.code}</p>
        <ul className="mt-6 space-y-2">
          {view.players.map((p) => (
            <li key={p.id} className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/5 px-3">
              <span className="font-bold">{p.name}</span>
              {p.isMe && <span className="text-xs text-dust">{view.me.gender === "f" ? "את" : "אתה"} · {view.me.realName}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-dust">
          {quick
            ? `משחק מהיר: יום של ${view.rules.quickDayMinutes} דקות, לילה של ${view.rules.quickNightMinutes} דקות. הכל בישיבה אחת.`
            : `משחק מתמשך: ביום ${view.schedule.dayStart}–${view.schedule.dayEnd}, ימים ${view.schedule.days.map((d) => ["א", "ב", "ג", "ד", "ה", "ו", "ש"][d]).join(" ")}. בלילה בעלי התפקידים פועלים.`}
        </p>
        <p className="mt-2 text-sm text-dust">
          {view.rules.botMode === "fill" ? "מקומות פנויים יתמלאו בשחקני AI." : "משחקים רק אנשים."} {view.rules.wolfCount} זאבים.
        </p>
        <div className="mt-auto space-y-3 pt-8">
          <div className="min-h-12 rounded-2xl bg-white/5 text-center leading-[3rem] text-dust">מחכים שהמנהל יתחיל</div>
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

  return (
    <div className={`flex h-dvh flex-col overflow-hidden text-paper ${night ? "bg-[#07060a]" : "bg-night"}`}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-extrabold leading-tight">מאפיה</div>
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
          <div className="flex min-h-0 w-full flex-1 flex-col">
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
            <div className="chat-scroll min-h-0 flex-1 space-y-3 px-3 py-3">
              <MessageList messages={view.messages.filter((m) => m.channel === activeChannel)} myId={view.me.playerId} />
              {typingHere.length > 0 && <Typing names={typingHere} />}
              <div ref={publicEnd} />
            </div>
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
                    aria-label="הודעה"
                  />
                  <button disabled={sending || !text.trim()} className="min-h-12 rounded-2xl bg-paper px-4 font-extrabold text-ink disabled:opacity-40">
                    {sending ? "…" : "שלח"}
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
                  ? `הצבעה. צריך ${majorityNeed} לרוב`
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
                    className={`relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-right ${
                      p.alive ? "bg-white/5" : "bg-black/30 opacity-60"
                    } ${pickedVote || pickedNight ? "ring-2 ring-paper" : ""}`}
                  >
                    {ratio > 0 && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 right-0 ${ratio >= 1 ? "bg-ember/35" : "bg-blood/30"}`}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    )}
                    {p.alive && !p.role ? (
                      <div
                        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-ink"
                        style={{ background: colorFor(p.id) }}
                      >
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
          <MePane view={view} />
        </div>
      </div>

      {err && <div className="px-4 pb-2 text-center text-sm text-red-300">{err}</div>}

      <nav className="sticky bottom-0 z-20 border-t border-white/10 bg-black/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {(
            [
              ["village", "כפר"],
              ["role", roleChannel ? "תפקיד •" : "תפקיד"],
              ["people", "שחקנים"],
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

function Typing({ names }: { names: string[] }) {
  const label = names.length === 1 ? `${names[0]} כותב…` : names.length === 2 ? `${names[0]} ו${names[1]} כותבים…` : `${names.length} אנשים כותבים…`;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-dust">
      <span className="typing-dots inline-flex gap-0.5" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>{label}</span>
    </div>
  );
}

function MessageList({ messages, myId }: { messages: ChatMessage[]; myId: string }) {
  const items = useMemo(() => {
    const out: { key: string; separator?: string; message?: ChatMessage }[] = [];
    let lastDay = "";
    for (const m of messages) {
      const day = dayKeyFmt.format(new Date(m.ts));
      if (day !== lastDay) {
        lastDay = day;
        out.push({ key: `sep-${day}`, separator: dayLabelFmt.format(new Date(m.ts)) });
      }
      out.push({ key: m.id, message: m });
    }
    return out;
  }, [messages]);

  return (
    <>
      {items.map((item) => {
        if (item.separator) {
          return (
            <div key={item.key} className="flex items-center gap-3 py-1 text-[11px] text-dust/70">
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
            <div key={item.key} className={`mx-auto max-w-[92%] rounded-2xl px-4 py-2 text-center text-sm ${cls}`}>
              <div>{m.text}</div>
              <div className="mt-0.5 text-[10px] opacity-50">{fmtTime(m.ts)}</div>
            </div>
          );
        }
        const mine = m.authorId === myId;
        return (
          <div key={item.key} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-ink"
              style={{ background: colorFor(m.authorId ?? m.authorName) }}
            >
              {initial(m.authorName)}
            </div>
            <div className={`min-w-0 ${mine ? "text-left" : ""}`}>
              <div className="mb-0.5 flex items-baseline gap-2 text-xs text-dust">
                <span>{m.authorName}</span>
                <span className="text-[10px] opacity-60">{fmtTime(m.ts)}</span>
              </div>
              <div className={`inline-block max-w-full rounded-2xl px-3 py-2 text-[15px] leading-snug ${mine ? "rounded-bl-md bg-[#3a2a22]" : "rounded-br-md bg-[#2a2420]"}`}>
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

function MePane({ view }: { view: LiveView }) {
  const role = view.me.role;
  const art = role ? ROLE_ART[role] : "/art/villager.png";
  return (
    <div className="space-y-3 pb-6">
      <div className="overflow-hidden rounded-3xl bg-white/5">
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
      </div>
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

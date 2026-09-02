"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { LiveView } from "@/lib/types";
import { ROLE_ART, ROLE_HE } from "@/lib/types";

type Tab = "village" | "role" | "people" | "me";
type StoredMe = { playerId: string; secret: string; fakeName: string };

const AVATAR = ["#e8a87c", "#7dcea0", "#f7dc6f", "#85c1e9", "#d7bde2", "#76d7c4", "#f5b7b1", "#aed6f1"];

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

function phaseHint(view: LiveView): string {
  if (view.waitText) return view.waitText;
  switch (view.phase) {
    case "lobby":
      return "מחכים שהמנהל יתחיל";
    case "day":
      return "מדברים ומצביעים";
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

function nightReminder(role: LiveView["me"]["role"]): string {
  switch (role) {
    case "wolf":
      return "בלילה אתה והחבילה בוחרים מי מת. ביום — משקרים יפה.";
    case "seer":
      return "בלילה אתה בודק אחד. זאב או לא. ביום — מדברים.";
    case "doctor":
      return "בלילה אתה שומר על אחד. גם על עצמך אפשר.";
    case "villager":
      return "ביום מדברים. מצביעים. אין לך פעולה בלילה.";
    default:
      return "עוד אין תפקיד. מחכים שיתחילו.";
  }
}

async function liveApi(body: Record<string, unknown>) {
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: string;
    game?: LiveView;
    me?: StoredMe;
    needsAuth?: boolean;
  };
  if (!res.ok) throw new Error(data.error ?? "לא הלך");
  return data;
}

export default function LiveGame({ code }: { code: string }) {
  const [view, setView] = useState<LiveView | null>(null);
  const [identity, setIdentity] = useState<StoredMe | null>(null);
  const [realName, setRealName] = useState("");
  const [tab, setTab] = useState<Tab>("village");
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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
          setIdentity({
            playerId: data.game.me.playerId,
            secret: "",
            fakeName: data.game.me.fakeName,
          });
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
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "לא הלך");
    }
  }, [code, identity]);

  useEffect(() => {
    if (!identity) return;
    void refresh();
  }, [identity, refresh]);

  useEffect(() => {
    if (!identity) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
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

  useEffect(() => {
    if (tab === "village" || tab === "role") publicEnd.current?.scrollIntoView({ block: "end" });
  }, [view?.messages.length, tab]);

  useEffect(() => {
    if (view?.me.canNightPick) setTab("role");
  }, [view?.me.canNightPick, view?.phase]);

  async function join(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const data = await liveApi({ action: "join", code, realName: realName.trim() });
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
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    }
  }

  async function nightPick(targetId: string) {
    if (!identity) return;
    try {
      const data = await liveApi({ action: "nightPick", code, secret: identity.secret, targetId });
      if (data.game) setView(data.game);
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
        <p className="mt-2 text-dust">קוד {code}. שם אמיתי רק אצלך.</p>
        <form onSubmit={(e) => void join(e)} className="mt-8 space-y-3">
          <input
            className="min-h-12 w-full rounded-2xl bg-white/10 px-4 text-paper"
            placeholder="השם שלך"
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
          />
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
    return (
      <div className="flex min-h-dvh items-center justify-center bg-night text-lg text-paper">טוען…</div>
    );
  }

  if (view.status === "lobby") {
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
              {p.isMe && (
                <span className="text-xs text-dust">
                  אתה · {view.me.realName}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-dust">
          ביום {view.schedule.dayStart}–{view.schedule.dayEnd}. ימים: {view.schedule.days.map((d) => ["א", "ב", "ג", "ד", "ה", "ו", "ש"][d]).join(" ")}.
        </p>
        <div className="mt-auto space-y-3 pt-8">
          <div className="min-h-12 rounded-2xl bg-white/5 text-center leading-[3rem] text-dust">
            מחכים שהמנהל יתחיל
          </div>
          {err && <p className="text-center text-sm text-red-300">{err}</p>}
        </div>
      </div>
    );
  }

  const majorityNeed = Math.floor(view.players.filter((p) => p.alive).length / 2) + 1;
  const roleChannel = view.me.role === "wolf" ? "wolves" : view.me.role === "seer" ? "seer" : view.me.role === "doctor" ? "doctor" : null;
  const activeChannel = tab === "role" ? roleChannel : "public";
  const roleChannelLabel = view.me.role === "wolf" ? "ערוץ הזאבים" : view.me.role === "seer" ? "יומן הרואה" : view.me.role === "doctor" ? "יומן הרופא" : "אין לך ערוץ פרטי";
  const roleChannelHint = view.me.role === "wolf" ? "רק חברי הלהקה רואים וכותבים כאן בלילה" : view.me.role === "seer" ? "רק תוצאות הבדיקות שלך מופיעות כאן" : view.me.role === "doctor" ? "רק בחירות השמירה שלך מופיעות כאן" : "לתושבים אין שיחת לילה פרטית";
  const canCompose = view.me.canSpeak && ((tab === "village" && view.phase === "day") || (tab === "role" && view.phase === "night_wolves" && view.me.role === "wolf"));

  return (
    <div className={`flex min-h-dvh flex-col text-paper ${night ? "bg-[#07060a]" : "bg-night"}`}>
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
            <div className="flex h-11 min-w-11 flex-col items-center justify-center rounded-full bg-blood px-3">
              <div className="text-base font-extrabold tabular-nums leading-none">{fmtRemain(left)}</div>
            </div>
          )}
          {view.me.isHost && (
            <Link href={`/admin/${code}`} className="text-xs text-dust underline-offset-4 hover:underline">
              ניהול
            </Link>
          )}
          <Link
            href="/"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm"
            aria-label="בית"
          >
            ⌂
          </Link>
        </div>
        {view.nextLockPretty && view.status === "running" && (
          <div className="mx-auto max-w-lg pt-1 text-center text-[11px] text-dust">
            נעילה {view.nextLockPretty}
          </div>
        )}
      </header>

      {view.winner && (
        <div className="bg-blood px-4 py-3 text-center text-lg font-extrabold">{view.winnerText}</div>
      )}
      {!view.me.alive && view.status !== "ended" && (
        <div className="bg-black px-4 py-3 text-center text-sm">
          מתת. היית {view.me.role ? ROLE_HE[view.me.role] : "?"}. אפשר לקרוא, לא לכתוב.
        </div>
      )}
      {view.waitText && (
        <div className="bg-white/5 px-4 py-2 text-center text-sm text-dust">{view.waitText}</div>
      )}

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
              {view.messages
                .filter((m) => m.channel === activeChannel)
                .map((m) => {
                  const repliedTo = m.replyToId
                    ? view.messages.find((candidate) => candidate.id === m.replyToId)
                    : null;
                  return <div key={m.id}>
                    {m.narrator ? (
                      <div className="mx-auto max-w-[90%] rounded-2xl bg-white/5 px-4 py-2 text-center text-sm text-dust">
                        {m.text}
                      </div>
                    ) : (
                      <div className="flex items-end gap-2">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-ink"
                          style={{ background: colorFor(m.authorId ?? m.authorName) }}
                        >
                          {initial(m.authorName)}
                        </div>
                        <div className="min-w-0">
                          <div className="mb-0.5 text-xs text-dust">{m.authorName}</div>
                          <div className="inline-block max-w-full rounded-2xl rounded-br-md bg-[#2a2420] px-3 py-2 text-[15px] leading-snug">
                            {repliedTo && (
                              <div className="mb-1 border-r-2 border-ember/60 pr-2 text-[11px] text-paper/45">
                                בתגובה ל{repliedTo.authorName}
                              </div>
                            )}
                            {m.text}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>;
                })}
              <div ref={publicEnd} />
            </div>
            {canCompose ? (
              <div className="border-t border-white/10">
                {tab === "village" && view.phase === "day" && (
                  <div className="chat-scroll flex items-center gap-1.5 overflow-x-auto px-3 pb-1 pt-2" aria-label="פנייה מהירה לשחקן">
                    <span className="shrink-0 text-[11px] text-dust">לפנות אל</span>
                    {view.players.filter((player) => player.alive && !player.isMe).map((player) => (
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
                {view.me.alive ? (tab === "role" ? "הערוץ ייפתח כשיגיע שלב התפקיד שלך" : "כיכר הכפר סגורה עכשיו") : "רק קריאה"}
              </div>
            )}
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "people" ? "block" : "hidden"}`}>
          <div className="mb-3 text-sm text-dust">
            {view.me.canVote
              ? `הצבעה. צריך ${majorityNeed} לרוב`
              : view.me.canNightPick
                ? view.me.nightAction === "wolf"
                  ? "בחר מי מת הלילה"
                  : view.me.nightAction === "seer"
                    ? "בחר מי לבדוק"
                    : "בחר על מי לשמור"
                : "עכשיו בלי פעולה"}
          </div>
          <ul className="space-y-2">
            {view.players.map((p) => {
              const pickedVote = view.me.myVote === p.id;
              const pickedNight = view.me.myNightPick === p.id;
              const packBlock =
                view.me.nightAction === "wolf" && (p.isMe || view.me.pack.includes(p.name));
              const tappable =
                (view.me.canVote && p.alive) ||
                (view.me.canNightPick &&
                  p.alive &&
                  !packBlock &&
                  !(view.me.nightAction === "seer" && p.isMe));
              return (
                <li key={p.id}>
                  <button
                    disabled={!tappable}
                    onClick={() => {
                      if (view.me.canVote) void vote(p.id);
                      else if (view.me.canNightPick) void nightPick(p.id);
                    }}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-3 text-right ${
                      p.alive ? "bg-white/5" : "bg-black/30 opacity-50"
                    } ${pickedVote || pickedNight ? "ring-2 ring-paper" : ""}`}
                  >
                    {p.alive ? (
                      <img
                        src="/art/villager.png"
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : p.role ? (
                      <img
                        src={ROLE_ART[p.role]}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-ink"
                        style={{ background: colorFor(p.id) }}
                      >
                        {initial(p.name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate font-bold ${p.alive ? "" : "line-through"}`}>
                          {p.name}
                          {p.isMe ? " · אתה" : ""}
                        </span>
                        {view.phase === "day" && p.alive && (
                          <span className="tabular-nums text-lg font-extrabold">{p.votes}</span>
                        )}
                      </div>
                      {p.voters.length ? (
                        <div className="mt-1 truncate text-xs text-dust">{p.voters.join(", ")}</div>
                      ) : null}
                      {!p.alive && p.role && (
                        <div className="text-xs text-dust">מת · {ROLE_HE[p.role]}</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
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
            <button
              key={id}
              className={`min-h-14 text-sm font-bold ${tab === id ? "text-paper" : "text-dust"}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
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
            {!view.me.alive ? " · מת" : ""}
          </div>
          <div className="mt-1 text-xs text-dust">
            {view.rules.identityMode === "aliases" ? `השם האמיתי שלך (רק אתה): ${view.me.realName}` : "זה השם שמוצג בכפר"}
          </div>
        </div>
      </div>
      <div className="rounded-2xl bg-white/5 p-4 text-[15px] leading-relaxed">{nightReminder(role)}</div>
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
              <div key={event.id}><span className="font-bold text-paper">{event.title}:</span> {event.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

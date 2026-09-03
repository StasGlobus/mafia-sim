"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AdminView } from "@/lib/types";
import { PERSONALITY_HE, ROLE_HE, WEEKDAY_CHIPS, WEEKDAYS_HE } from "@/lib/types";

type Tab = "manage" | "players" | "secrets";
type StoredMe = { playerId: string; secret: string; fakeName: string };
type Gate = "loading" | "admin" | "notHost" | "noIdentity" | "missing";

function loadMe(code: string): StoredMe | null {
  try {
    const raw = localStorage.getItem(`mafia-live:${code}`);
    return raw ? (JSON.parse(raw) as StoredMe) : null;
  } catch {
    return null;
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

function daysLabel(days: number[]): string {
  return days
    .slice()
    .sort()
    .map((d) => WEEKDAY_CHIPS.find((c) => c.i === d)?.l ?? WEEKDAYS_HE[d] ?? String(d))
    .join(" ");
}

async function liveApi(body: Record<string, unknown>) {
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: string;
    game?: AdminView;
    me?: StoredMe;
    needsAuth?: boolean;
  };
  if (res.status === 403) {
    const err = new Error(data.error ?? "רק המנהל") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error(data.error ?? "אין משחק כזה") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (res.status === 401) {
    const err = new Error(data.error ?? "חסר מפתח") as Error & { status: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) throw new Error(data.error ?? "לא הלך");
  return data;
}

export default function AdminGame({ code }: { code: string }) {
  const [view, setView] = useState<AdminView | null>(null);
  const [identity, setIdentity] = useState<StoredMe | null>(null);
  const [gate, setGate] = useState<Gate>("loading");
  const [tab, setTab] = useState<Tab>("manage");
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);
  const [dayStart, setDayStart] = useState("10:00");
  const [dayEnd, setDayEnd] = useState("22:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = loadMe(code);
    if (stored) setIdentity(stored);
  }, [code]);

  const applyView = useCallback((game: AdminView | undefined) => {
    if (!game || game.isAdmin !== true) {
      setGate("notHost");
      setView(null);
      return;
    }
    setView(game);
    setGate("admin");
    setDayStart(game.schedule.dayStart);
    setDayEnd(game.schedule.dayEnd);
    setDays([...game.schedule.days]);
  }, []);

  const refresh = useCallback(async () => {
    const me = identity ?? loadMe(code);
    try {
      const data = await liveApi({
        action: "admin",
        code,
        secret: me?.secret ?? "",
        asAdmin: true,
      });
      applyView(data.game);
      setErr(null);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 403) {
        setGate("notHost");
        setView(null);
        return;
      }
      if (status === 404) {
        setGate("missing");
        setView(null);
        return;
      }
      if (status === 401 && !me) {
        setGate("noIdentity");
        setView(null);
        return;
      }
      if (status === 401) {
        setGate("noIdentity");
        setView(null);
        return;
      }
      setErr(e instanceof Error ? e.message : "לא הלך");
    }
  }, [code, identity, applyView]);

  useEffect(() => {
    void (async () => {
      const stored = loadMe(code);
      if (stored) {
        setIdentity(stored);
        return;
      }
      try {
        const res = await fetch(`/api/live?code=${encodeURIComponent(code)}&asAdmin=true`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          game?: AdminView;
          needsAuth?: boolean;
          error?: string;
        };
        if (res.status === 403) {
          setGate("notHost");
          return;
        }
        if (res.status === 404) {
          setGate("missing");
          return;
        }
        if (data.game?.isAdmin) {
          applyView(data.game);
          return;
        }
        setGate("noIdentity");
      } catch {
        setGate("noIdentity");
      }
    })();
  }, [code, applyView]);

  useEffect(() => {
    if (!identity) return;
    void refresh();
  }, [identity, refresh]);

  useEffect(() => {
    if (gate !== "admin") return;
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
  }, [gate, refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const playerUrl = useMemo(() => {
    if (typeof window !== "undefined") return `${window.location.origin}/g/${code}`;
    return `/g/${code}`;
  }, [code]);
  const adminUrl = useMemo(() => {
    if (typeof window !== "undefined") return `${window.location.origin}/admin/${code}`;
    return `/admin/${code}`;
  }, [code]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setErr("לא הועתק");
    }
  }

  function toggleDay(i: number) {
    setDays((cur) => {
      if (cur.includes(i)) {
        const next = cur.filter((d) => d !== i);
        return next.length ? next : cur;
      }
      return [...cur, i].sort();
    });
  }

  async function updateSchedule(e?: FormEvent) {
    e?.preventDefault();
    if (!identity) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await liveApi({
        action: "setSchedule",
        code,
        secret: identity.secret,
        dayStart,
        dayEnd,
        days,
      });
      applyView(data.game);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    if (!identity) return;
    if (!window.confirm("לסיים את המשחק עכשיו? כל התפקידים ייחשפו לכולם.")) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await liveApi({ action: "end", code, secret: identity.secret, asAdmin: true });
      applyView(data.game);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!identity) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await liveApi({
        action: "start",
        code,
        secret: identity.secret,
        asAdmin: true,
      });
      applyView(data.game);
    } catch (er) {
      setErr(er instanceof Error ? er.message : "לא הלך");
    } finally {
      setBusy(false);
    }
  }

  if (gate === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-night text-lg text-paper">טוען…</div>
    );
  }

  if (gate === "missing") {
    return (
      <GateScreen
        title="אין משחק כזה"
        body="הקוד לא יושב על שולחן פתוח."
        code={code}
      />
    );
  }

  if (gate === "notHost") {
    return (
      <GateScreen
        title="רק המנהל"
        body="יש לך כניסה כשחקן, לא כמנהל. ניהול רק למי שפתח את השולחן."
        code={code}
      />
    );
  }

  if (gate === "noIdentity" || !view) {
    return (
      <GateScreen
        title="ניהול רק למי שפתח"
        body="אין כאן כניסה עם שם. אם באת לשחק — כנס במסך השחקנים. אם אתה המנהל, פתח מהמכשיר שבו יצרת את השולחן."
        code={code}
      />
    );
  }

  const left = view.nextLockAt ? Math.max(0, new Date(view.nextLockAt).getTime() - now) : 0;
  const lobby = view.status === "lobby";
  const running = view.status === "running";
  const humansOnlyNeedsMore = view.rules.botMode === "humans_only" && view.humansJoined < view.rules.seats;

  return (
    <div className="flex min-h-dvh flex-col bg-night text-paper">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-extrabold leading-tight">ניהול · {view.code}</div>
            <div className="truncate text-xs text-dust">
              {view.dayNumber ? `יום ${view.dayNumber} · ` : ""}
              {view.phaseLabel}
            </div>
          </div>
          {running && view.nextLockAt && (
            <div className="flex h-11 min-w-11 flex-col items-center justify-center rounded-full bg-blood px-3">
              <div className="text-base font-extrabold tabular-nums leading-none">{fmtRemain(left)}</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void copy(playerUrl, "top")}
            className="rounded-full bg-white/10 px-3 py-2 text-xs font-bold"
          >
            {copied === "top" ? "הועתק" : "קישור שחקנים"}
          </button>
        </div>
        {view.nextLockPretty && running && (
          <div className="mx-auto max-w-lg pt-1 text-center text-[11px] text-dust">
            נעילה {view.nextLockPretty}
          </div>
        )}
      </header>

      {view.winner && (
        <div className="bg-blood px-4 py-3 text-center text-lg font-extrabold">{view.winnerText}</div>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "manage" ? "block" : "hidden"}`}>
          {lobby ? (
            <form onSubmit={(e) => void updateSchedule(e)} className="space-y-4">
              <RulesCard view={view} />
              {view.rules.mode === "quick" ? (
                <div className="rounded-3xl bg-white/5 p-4">
                  <div className="font-extrabold">משחק מהיר</div>
                  <p className="mt-2 text-sm text-dust">
                    יום של {view.rules.quickDayMinutes} דקות, לילה של {view.rules.quickNightMinutes} דקות. המשחק מתחיל ברגע שלוחצים התחל, אז תאספו את כולם קודם.
                  </p>
                </div>
              ) : (
              <div className="rounded-3xl bg-white/5 p-4">
                <div className="font-extrabold">שעות וימים</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-dust">פתיחה</span>
                    <input
                      type="time"
                      value={dayStart}
                      onChange={(e) => setDayStart(e.target.value)}
                      className="mt-1 min-h-12 w-full rounded-2xl bg-white/10 px-3 text-paper"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-dust">סגירה</span>
                    <input
                      type="time"
                      value={dayEnd}
                      onChange={(e) => setDayEnd(e.target.value)}
                      className="mt-1 min-h-12 w-full rounded-2xl bg-white/10 px-3 text-paper"
                    />
                  </label>
                </div>
                <div className="mt-4 text-sm text-dust">ימים</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAY_CHIPS.map((d) => {
                    const on = days.includes(d.i);
                    return (
                      <button
                        key={d.i}
                        type="button"
                        onClick={() => toggleDay(d.i)}
                        className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-extrabold ${
                          on ? "bg-paper text-ink" : "bg-white/10 text-dust"
                        }`}
                      >
                        {d.l}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-5 min-h-12 w-full rounded-2xl bg-white/10 font-extrabold disabled:opacity-40"
                >
                  עדכן
                </button>
              </div>
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy || humansOnlyNeedsMore}
                className="min-h-14 w-full rounded-2xl bg-paper text-lg font-extrabold text-ink disabled:opacity-40"
              >
                {view.rules.botMode === "fill" ? "השלם בבוטים והתחל" : humansOnlyNeedsMore ? `מחכים לעוד ${view.rules.seats - view.humansJoined}` : "התחל עם השחקנים"}
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              <RulesCard view={view} />
              <div className="rounded-3xl bg-white/5 p-4">
                <div className="font-extrabold">{view.rules.mode === "quick" ? "קצב" : "לוח זמנים"}</div>
                <p className="mt-2 text-sm text-dust">
                  {view.rules.mode === "quick"
                    ? `יום ${view.rules.quickDayMinutes} דקות · לילה ${view.rules.quickNightMinutes} דקות`
                    : `${view.schedule.dayStart}–${view.schedule.dayEnd} · ימים ${daysLabel(view.schedule.days)}`}
                </p>
                <p className="mt-2 text-sm">
                  שלב: {view.phaseLabel}
                  {view.dayNumber ? ` · יום ${view.dayNumber}` : ""}
                </p>
                {view.nextLockPretty && (
                  <p className="mt-1 text-sm text-dust">נעילה הבאה {view.nextLockPretty}</p>
                )}
                {view.waitText && <p className="mt-1 text-sm text-dust">{view.waitText}</p>}
              </div>
              {running && (
                <button
                  type="button"
                  onClick={() => void endGame()}
                  disabled={busy}
                  className="min-h-12 w-full rounded-2xl border border-ember/40 bg-ember/10 font-extrabold text-red-100 disabled:opacity-40"
                >
                  לסיים את המשחק ולחשוף את הקלפים
                </button>
              )}
            </div>
          )}

          <div className="mt-4 space-y-2 rounded-3xl bg-white/5 p-4">
            <div className="font-extrabold">קישורים</div>
            <CopyRow
              label="קישור לשחקנים"
              value={playerUrl}
              copied={copied === "player"}
              onCopy={() => void copy(playerUrl, "player")}
            />
            <CopyRow
              label="קישור לניהול"
              value={adminUrl}
              copied={copied === "admin"}
              onCopy={() => void copy(adminUrl, "admin")}
            />
            <Link href={`/g/${code}`} className="mt-2 block text-center text-sm text-dust underline-offset-4 hover:underline">
              לשחק כשחקן
            </Link>
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "players" ? "block" : "hidden"}`}>
          <div className="mb-3 text-sm text-dust">
            {view.humansJoined} בני אדם · {view.players.length}/{view.seats} שמות
          </div>
          <ul className="space-y-2">
            {view.players.map((p) => (
              <li key={p.id} className={`rounded-2xl px-3 py-3 ${p.alive ? "bg-white/5" : "bg-black/30 opacity-70"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-bold ${p.alive ? "" : "line-through"}`}>{p.name}</span>
                  <span className="text-xs text-dust">{p.alive ? "חי" : "מת"}</span>
                </div>
                <div className="mt-1 text-sm text-dust">
                  שם אמיתי: {p.kind === "human" ? p.realName || "—" : "«בוט»"}
                </div>
                <div className="mt-1 text-xs text-dust">
                  {lobby
                    ? p.kind === "human"
                      ? "עוד אין תפקיד"
                      : "בוט"
                    : `${p.role ? ROLE_HE[p.role] : "?"} · ${PERSONALITY_HE[p.personality]}`}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "secrets" ? "block" : "hidden"}`}>
          <SecretsPane view={view} />
        </div>
      </div>

      {err && <div className="px-4 pb-2 text-center text-sm text-red-300">{err}</div>}

      <nav className="sticky bottom-0 z-20 border-t border-white/10 bg-black/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto grid max-w-lg grid-cols-3">
          {(
            [
              ["manage", "ניהול"],
              ["players", "שחקנים"],
              ["secrets", "סודות"],
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

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-xs text-dust">{label}</div>
      <div className="mt-1 break-all text-sm">{value}</div>
      <button
        type="button"
        onClick={onCopy}
        className="mt-2 min-h-10 w-full rounded-2xl bg-white/10 text-sm font-bold"
      >
        {copied ? "הועתק" : "העתק"}
      </button>
    </div>
  );
}

function RulesCard({ view }: { view: AdminView }) {
  const style = view.rules.directorStyle === "classic" ? "קלאסי" : view.rules.directorStyle === "wild" ? "פרוע" : "דינמי";
  return (
    <div className="rounded-3xl border border-ember/20 bg-ember/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-extrabold">חוקי השולחן</div>
        <span className="rounded-full bg-black/20 px-2.5 py-1 text-xs font-bold">במאי AI · {style}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-dust">
        <div>{view.rules.mode === "quick" ? "משחק מהיר" : "משחק מתמשך"}</div>
        <div>{view.rules.seats} מקומות · {view.rules.wolfCount} זאבים</div>
        <div>{view.rules.identityMode === "real" ? "שמות אמיתיים" : "שמות בדויים"}</div>
        <div>{view.rules.botMode === "fill" ? "AI משלים מקומות" : "אנשים בלבד"}</div>
        <div>{[view.rules.hasSeer && "רואה", view.rules.hasDoctor && "רופא"].filter(Boolean).join(" · ") || "ללא תפקידי כוח"}</div>
      </div>
    </div>
  );
}

function SecretsPane({ view }: { view: AdminView }) {
  return (
    <div className="space-y-3 pb-6">
      <div className="rounded-2xl bg-white/5 p-4">
        <div className="font-extrabold">בחירות לילה</div>
        <div className="mt-2 space-y-1 text-sm text-dust">
          <div>זאב: {view.night.wolfTargetName ?? "—"}</div>
          <div>רואה: {view.night.seerTargetName ?? "—"}</div>
          <div>רופא: {view.night.doctorTargetName ?? "—"}</div>
        </div>
      </div>
      <MsgBlock title="זאבים" msgs={view.wolfMsgs} />
      <MsgBlock title="רואה" msgs={view.seerMsgs} />
      <MsgBlock title="רופא" msgs={view.doctorMsgs} />
      <MsgBlock title="הצ'אט" msgs={view.messages} />
      {view.directorEvents.length > 0 && (
        <div className="rounded-2xl border border-ember/20 bg-ember/10 p-4">
          <div className="mb-2 font-extrabold">החלטות הבמאי</div>
          <div className="space-y-3 text-sm">
            {view.directorEvents.map((event) => (
              <div key={event.id}>
                <div className="font-bold">{event.title} · יום {event.dayNumber}</div>
                <div className="mt-0.5 text-dust">{event.text}</div>
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
      {view.winner && (
        <div className="rounded-2xl bg-blood p-4 font-extrabold">{view.winnerText}</div>
      )}
      {view.eventLog.length > 0 && (
        <div className="rounded-2xl bg-white/5 p-4">
          <div className="mb-2 font-extrabold">יומן</div>
          <div className="space-y-1 text-sm text-dust">
            {view.eventLog.map((line, i) => (
              <div key={`${i}-${line}`}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MsgBlock({
  title,
  msgs,
}: {
  title: string;
  msgs: AdminView["messages"];
}) {
  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="font-extrabold">{title}</div>
      {msgs.length === 0 ? (
        <div className="mt-2 text-sm text-dust">ריק</div>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          {msgs.map((m) => (
            <div key={m.id} className={m.narrator ? "text-dust" : ""}>
              {m.narrator ? m.text : `${m.authorName}: ${m.text}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GateScreen({ title, body, code }: { title: string; body: string; code: string }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-night px-4 py-8 text-paper">
      <Link href="/admin" className="text-sm text-dust">
        ← חזרה
      </Link>
      <h1 className="font-display mt-8 text-3xl font-extrabold">{title}</h1>
      <p className="mt-3 text-dust">{body}</p>
      <p className="mt-2 text-sm text-dust">קוד {code}</p>
      <div className="mt-auto space-y-3 pt-10">
        <Link
          href={`/g/${code}`}
          className="flex min-h-14 items-center justify-center rounded-2xl bg-paper text-lg font-extrabold text-ink"
        >
          לשחק כשחקן
        </Link>
        <Link
          href="/admin"
          className="flex min-h-12 items-center justify-center rounded-2xl bg-white/10 font-bold"
        >
          למסך ניהול
        </Link>
      </div>
    </div>
  );
}

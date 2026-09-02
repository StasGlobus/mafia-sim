"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GameConfig, GameState, Speed } from "@/lib/types";
import { CHANNEL_HE, DEFAULT_CONFIG, PERSONALITY_HE, ROLE_HE } from "@/lib/types";

type Tab = "chat" | "people" | "watch";

async function api(action: string, extra?: Record<string, unknown>): Promise<GameState> {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  return res.json();
}

function remainingWallMs(s: GameState): number {
  if (s.status !== "running" && s.status !== "paused") return 0;
  const left1x = Math.max(0, s.phaseDurationMs - s.phaseElapsedMs);
  return left1x / Math.max(1, s.speed);
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `${r}`;
}

const AVATAR = ["#e8a87c", "#7dcea0", "#f7dc6f", "#85c1e9", "#d7bde2", "#76d7c4", "#f5b7b1", "#aed6f1"];
function colorFor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % AVATAR.length;
  return AVATAR[n]!;
}
function initial(name: string) {
  return name.trim().slice(0, 1) || "?";
}

function voteTally(s: GameState) {
  const counts: Record<string, { name: string; n: number; voters: string[]; alive: boolean; id: string }> = {};
  for (const p of s.players) {
    counts[p.id] = { id: p.id, name: p.name, n: 0, voters: [], alive: p.alive };
  }
  for (const [voterId, targetId] of Object.entries(s.votes)) {
    const voter = s.players.find((p) => p.id === voterId);
    if (!voter?.alive || !counts[targetId]) continue;
    counts[targetId].n += 1;
    counts[targetId].voters.push(voter.name);
  }
  return Object.values(counts);
}

function phaseHint(phase: GameState["phase"]): string {
  switch (phase) {
    case "dawn":
      return "בוקר. מי מת?";
    case "day":
      return "מדברים ומצביעים";
    case "hang":
      return "יש רוב";
    case "night_wolves":
      return "הזאבים בוחרים";
    case "night_seer":
      return "הרואה בודק";
    case "night_doctor":
      return "הרופא שומר";
    case "ended":
      return "נגמר";
    default:
      return "";
  }
}

export default function Simulator() {
  const [state, setState] = useState<GameState | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [menu, setMenu] = useState(false);
  const [how, setHow] = useState(false);
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [err, setErr] = useState<string | null>(null);
  const publicEnd = useRef<HTMLDivElement>(null);
  const watchEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/game", { cache: "no-store" });
      const data = (await res.json()) as GameState;
      setState(data);
      if (data.config) setConfig(data.config);
    } catch {
      setErr("לא מצליח להתחבר");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        try {
          const running = state?.status === "running";
          const data = running ? await api("tick") : await (await fetch("/api/game", { cache: "no-store" })).json();
          setState(data);
        } catch {
          /* keep last */
        }
      })();
    }, 1000);
    return () => clearInterval(id);
  }, [state?.status]);

  useEffect(() => {
    if (tab === "chat") publicEnd.current?.scrollIntoView({ block: "end" });
  }, [state?.messages.length, tab]);

  const publicMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "public"),
    [state?.messages],
  );
  const wolfMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "wolves"),
    [state?.messages],
  );
  const seerMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "seer"),
    [state?.messages],
  );
  const doctorMsgs = useMemo(
    () => (state?.messages ?? []).filter((m) => m.channel === "doctor"),
    [state?.messages],
  );

  const majorityNeed = state ? Math.floor(state.players.filter((p) => p.alive).length / 2) + 1 : 0;
  const tally = state ? voteTally(state) : [];
  const left = state ? remainingWallMs(state) : 0;

  async function start(speedOverride?: Speed) {
    const data = await api("start", { config, speed: speedOverride ?? state?.speed ?? 1 });
    setState(data);
    setTab("chat");
    setMenu(false);
  }

  if (!state) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-night p-6 text-lg text-paper">
        טוען…
      </div>
    );
  }

  const empty = state.status === "idle" && state.players.length === 0;
  const night = state.phase.startsWith("night");

  return (
    <div className={`flex min-h-dvh flex-col text-paper ${night ? "bg-[#07060a]" : "bg-night"}`}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-base font-extrabold leading-tight">AiYara · סימולטור</div>
            {state.status !== "idle" ? (
              <div className="truncate text-xs text-dust">
                יום {state.dayNumber} · {phaseHint(state.phase)}
              </div>
            ) : (
              <div className="text-xs text-dust">8 שמות. מי הזאב.</div>
            )}
          </div>
          {state.status !== "idle" && state.status !== "ended" && (
            <div className="flex h-11 min-w-11 items-center justify-center rounded-full bg-blood px-3 text-base font-extrabold tabular-nums">
              {fmt(left)}
            </div>
          )}
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-lg"
            onClick={() => setHow(true)}
            aria-label="איך משחקים"
          >
            ?
          </button>
          {!empty && (
            <button
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-lg"
              onClick={() => setMenu((v) => !v)}
              aria-label="תפריט"
            >
              ⋯
            </button>
          )}
        </div>
      </header>

      {state.winner && (
        <div className="bg-blood px-4 py-3 text-center text-lg font-extrabold">{state.winnerText}</div>
      )}

      {empty ? (
        <EmptyStart config={config} setConfig={setConfig} onStart={() => void start()} onFastStart={() => void start(16)} err={err} onHow={() => setHow(true)} />
      ) : (
        <>
          {menu && (
            <MenuSheet
              state={state}
              config={config}
              setConfig={setConfig}
              setState={setState}
              onStart={() => void start()}
              onClose={() => setMenu(false)}
            />
          )}
          <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
            <div className={`min-h-0 flex-1 ${tab === "chat" ? "flex" : "hidden"}`}>
              <ChatPane state={state} msgs={publicMsgs} endRef={publicEnd} night={night} />
            </div>
            <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "people" ? "block" : "hidden"}`}>
              <PeoplePane state={state} tally={tally} majorityNeed={majorityNeed} />
            </div>
            <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${tab === "watch" ? "block" : "hidden"}`}>
              <WatchPane
                state={state}
                wolfMsgs={wolfMsgs}
                seerMsgs={seerMsgs}
                doctorMsgs={doctorMsgs}
                left={left}
                endRef={watchEnd}
              />
            </div>
          </div>
          <nav className="sticky bottom-0 z-20 border-t border-white/10 bg-black/70 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
            <div className="mx-auto grid max-w-lg grid-cols-3">
              {(
                [
                  ["chat", "צ'אט"],
                  ["people", "שחקנים"],
                  ["watch", "צופה"],
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
        </>
      )}

      {how && <HowSheet onClose={() => setHow(false)} />}
    </div>
  );
}

function EmptyStart({
  config,
  setConfig,
  onStart,
  onFastStart,
  err,
  onHow,
}: {
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
  onStart: () => void;
  onFastStart: () => void;
  err: string | null;
  onHow: () => void;
}) {
  const [times, setTimes] = useState(false);
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-8 pt-8">
      <h1 className="text-center text-4xl font-extrabold leading-tight">מי הזאב?</h1>
      <p className="mt-3 text-center text-base text-dust">8 כותבים בצ'אט. שניים מהם זאבים. תעקוב.</p>
      <ol className="mt-8 space-y-3 text-base">
        <li className="rounded-2xl bg-white/5 px-4 py-3">יום — מדברים. מצביעים. רוב תולים.</li>
        <li className="rounded-2xl bg-white/5 px-4 py-3">לילה — זאבים הורגים. רואה בודק. רופא שומר.</li>
        <li className="rounded-2xl bg-white/5 px-4 py-3">מי שנשאר, מנצח.</li>
      </ol>
      <div className="mt-auto space-y-3 pt-8">
        <button
          onClick={onStart}
          className="min-h-14 w-full rounded-2xl bg-paper text-xl font-extrabold text-ink active:opacity-80"
        >
          יאללה, משחק
        </button>
        <button
          onClick={onFastStart}
          className="min-h-12 w-full rounded-2xl border border-ember/30 bg-ember/10 text-sm font-black text-red-100"
        >
          מצב פיתוח · סימולציה מהירה 16×
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onHow} className="min-h-12 rounded-2xl bg-white/10 text-sm font-bold">
            איך זה עובד
          </button>
          <button onClick={() => setTimes((v) => !v)} className="min-h-12 rounded-2xl bg-white/10 text-sm font-bold">
            זמנים
          </button>
        </div>
        {times && <ConfigFields config={config} setConfig={setConfig} />}
        {err && <p className="text-center text-sm text-red-300">{err}</p>}
      </div>
    </main>
  );
}

function ConfigFields({
  config,
  setConfig,
}: {
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
}) {
  function num(key: keyof GameConfig, label: string) {
    return (
      <label className="flex min-h-12 items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <input
          type="number"
          min={3}
          max={180}
          className="h-11 w-20 rounded-xl bg-white/10 px-2 text-left text-paper"
          value={Math.round(config[key] / 1000)}
          onChange={(e) =>
            setConfig({ ...config, [key]: Math.max(3, Number(e.target.value) || 3) * 1000 })
          }
        />
      </label>
    );
  }
  return (
    <div className="space-y-1 rounded-2xl bg-white/5 p-3">
      <div className="text-xs text-dust">שניות במהירות 1×</div>
      {num("dayMs", "יום")}
      {num("nightStepMs", "שלב לילה")}
      {num("dawnMs", "בוקר")}
      {num("hangMs", "תלייה")}
    </div>
  );
}

function MenuSheet({
  state,
  config,
  setConfig,
  setState,
  onStart,
  onClose,
}: {
  state: GameState;
  config: GameConfig;
  setConfig: (c: GameConfig) => void;
  setState: (s: GameState) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const [times, setTimes] = useState(false);
  async function send(action: string, extra?: Record<string, unknown>) {
    const data = await api(action, extra);
    setState(data);
  }
  return (
    <div className="fixed inset-0 z-30 bg-black/70 p-4" onClick={onClose}>
      <div
        className="mx-auto mt-16 max-w-sm space-y-2 rounded-3xl bg-[#1a1410] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pb-2 text-center text-sm text-dust">תפריט</div>
        {state.status === "running" && (
          <button className="min-h-12 w-full rounded-2xl bg-white/10 font-bold" onClick={() => send("pause")}>
            השהה
          </button>
        )}
        {state.status === "paused" && (
          <button className="min-h-12 w-full rounded-2xl bg-moss font-bold" onClick={() => send("resume")}>
            המשך
          </button>
        )}
        <div className="grid grid-cols-4 gap-2">
          {([1, 4, 8, 16] as Speed[]).map((sp) => (
            <button
              key={sp}
              className={`min-h-12 rounded-2xl font-bold ${state.speed === sp ? "bg-paper text-ink" : "bg-white/10"}`}
              onClick={() => send("setSpeed", { speed: sp })}
            >
              {sp}×
            </button>
          ))}
        </div>
        <button className="min-h-12 w-full rounded-2xl bg-white/10 font-bold" onClick={() => setTimes((v) => !v)}>
          זמנים
        </button>
        {times && (
          <>
            <ConfigFields config={config} setConfig={setConfig} />
            <button
              className="min-h-12 w-full rounded-2xl bg-paper font-bold text-ink"
              onClick={() => send("setConfig", { config })}
            >
              עדכן
            </button>
          </>
        )}
        <button className="min-h-12 w-full rounded-2xl bg-blood font-bold" onClick={onStart}>
          משחק חדש
        </button>
        <button className="min-h-12 w-full text-dust" onClick={onClose}>
          סגור
        </button>
      </div>
    </div>
  );
}

function HowSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/70 p-4" onClick={onClose}>
      <div className="mx-auto mt-12 max-w-sm space-y-3 rounded-3xl bg-[#1a1410] p-5 text-base leading-relaxed" onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-extrabold">בקצרה</div>
        <p>זה סימולטור. 8 שחקנים, כולם בוטים. אתה צופה.</p>
        <p>
          <b>צ'אט</b> — מה ששחקן היה רואה.
        </p>
        <p>
          <b>שחקנים</b> — על מי שמים יד. צריך רוב.
        </p>
        <p>
          <b>צופה</b> — התפקידים האמיתיים. זה בשבילך, לא בשבילם.
        </p>
        <p>זאב הורג בלילה. רואה בודק. רופא מציל. ביום תולים.</p>
        <button className="min-h-12 w-full rounded-2xl bg-paper font-bold text-ink" onClick={onClose}>
          סגור
        </button>
      </div>
    </div>
  );
}

function ChatPane({
  state,
  msgs,
  endRef,
  night,
}: {
  state: GameState;
  msgs: GameState["messages"];
  endRef: RefObject<HTMLDivElement | null>;
  night: boolean;
}) {
  return (
    <div className={`flex min-h-0 w-full flex-1 flex-col ${night ? "opacity-95" : ""}`}>
      <div className="chat-scroll min-h-0 flex-1 space-y-3 px-3 py-3">
        {msgs.map((m) => (
          <div key={m.id}>
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
                    {m.text}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {(state.phase === "day" || state.phase === "hang") && (
        <div className="border-t border-white/10 px-3 py-2 text-center text-xs text-dust">
          הצבעה במסך שחקנים
        </div>
      )}
    </div>
  );
}

function PeoplePane({
  state,
  tally,
  majorityNeed,
}: {
  state: GameState;
  tally: ReturnType<typeof voteTally>;
  majorityNeed: number;
}) {
  const voting = state.phase === "day" || state.phase === "hang";
  const byId = Object.fromEntries(tally.map((t) => [t.id, t]));
  const maxN = Math.max(1, ...tally.map((t) => t.n));
  return (
    <div>
      <div className="mb-3 text-sm text-dust">
        {voting ? `צריך ${majorityNeed} לרוב` : "עכשיו בלי הצבעה"}
      </div>
      <ul className="space-y-2">
        {state.players.map((p) => {
          const t = byId[p.id];
          const n = t?.n ?? 0;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${p.alive ? "bg-white/5" : "bg-black/30 opacity-50"}`}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-ink"
                style={{ background: colorFor(p.id) }}
              >
                {initial(p.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate font-bold ${p.alive ? "" : "line-through"}`}>{p.name}</span>
                  {voting && p.alive && <span className="tabular-nums text-lg font-extrabold">{n}</span>}
                </div>
                {voting && p.alive && (
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/40">
                    <div
                      className="h-full rounded-full bg-paper"
                      style={{ width: `${(n / Math.max(majorityNeed, maxN)) * 100}%` }}
                    />
                  </div>
                )}
                {t?.voters.length ? (
                  <div className="mt-1 truncate text-xs text-dust">{t.voters.join(", ")}</div>
                ) : null}
                {!p.alive && <div className="text-xs text-dust">מת</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WatchPane({
  state,
  wolfMsgs,
  seerMsgs,
  doctorMsgs,
  left,
  endRef,
}: {
  state: GameState;
  wolfMsgs: GameState["messages"];
  seerMsgs: GameState["messages"];
  doctorMsgs: GameState["messages"];
  left: number;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  const wolfPick = state.players.find((p) => p.id === state.night.wolfTarget);
  const seerPick = state.players.find((p) => p.id === state.night.seerTarget);
  const docPick = state.players.find((p) => p.id === state.night.doctorTarget);
  return (
    <div className="space-y-3 pb-4 text-[15px]">
      <div className="rounded-2xl bg-white/5 p-4">
        <div className="font-extrabold">רק אתה רואה את זה</div>
        <div className="mt-1 text-dust">
          עכשיו: {CHANNEL_HE[state.openChannel]} · {fmt(left)} שנ׳ · {state.speed}×
          {state.status === "paused" ? " · מושהה" : ""}
        </div>
      </div>
      <ul className="space-y-2">
        {state.players.map((p) => (
          <li
            key={p.id}
            className={`flex min-h-12 items-center justify-between rounded-2xl px-3 py-2 ${p.alive ? "bg-white/5" : "bg-black/30 text-dust line-through"}`}
          >
            <span>
              {p.name}
              <span className="mr-2 text-xs no-underline text-dust"> {PERSONALITY_HE[p.personality]}</span>
            </span>
            <span className={`text-sm font-bold ${p.role === "wolf" ? "text-red-300" : "text-emerald-200"}`}>
              {ROLE_HE[p.role]}
              {p.muted ? " · שותק" : ""}
              {p.cannotVote ? " · בלי הצבעה" : ""}
            </span>
          </li>
        ))}
      </ul>
      <Priv title="זאבים" lines={wolfMsgs.map((m) => `${m.authorName}: ${m.text}`)} extra={wolfPick ? `הורגים: ${wolfPick.name}` : ""} />
      <Priv title="רואה" lines={seerMsgs.map((m) => m.text)} extra={seerPick ? `בודק: ${seerPick.name}` : ""} />
      <Priv title="רופא" lines={doctorMsgs.map((m) => m.text)} extra={docPick ? `שומר: ${docPick.name}` : ""} />
      <div className="rounded-2xl bg-white/5 p-4">
        <div className="mb-2 font-extrabold">מה קרה</div>
        <div className="space-y-1 text-sm text-dust">
          {(state.eventLog.length ? state.eventLog : ["עוד כלום"]).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function Priv({ title, lines, extra }: { title: string; lines: string[]; extra: string }) {
  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="font-extrabold">{title}</div>
      {extra && <div className="mt-1 text-sm text-[#e8d7b0]">{extra}</div>}
      <div className="mt-2 space-y-1 text-sm text-dust">
        {lines.length ? lines.map((t, i) => <div key={i}>{t}</div>) : <div>שקט</div>}
      </div>
    </div>
  );
}

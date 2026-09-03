"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { QUICK_DAY_OPTIONS, QUICK_NIGHT_OPTIONS, ROOM_CODE_LENGTH, WEEKDAY_CHIPS, type BotMode, type DirectorStyle, type GameMode, type Gender, type IdentityMode } from "@/lib/types";

function saveMe(code: string, me: { playerId: string; secret: string; fakeName: string }) {
  try {
    localStorage.setItem(`mafia-live:${code}`, JSON.stringify(me));
  } catch {
    /* The secure cookie still keeps the session available. */
  }
}

const HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hour}:${index % 2 ? "30" : "00"}`;
});

function cleanRoomCode(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

export default function AdminHomePage() {
  const router = useRouter();
  const [realName, setRealName] = useState("");
  const [code, setCode] = useState("");
  const [dayStart, setDayStart] = useState("10:00");
  const [dayEnd, setDayEnd] = useState("22:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [seats, setSeats] = useState(8);
  const [wolfCount, setWolfCount] = useState(2);
  const [hasSeer, setHasSeer] = useState(true);
  const [hasDoctor, setHasDoctor] = useState(true);
  const [identityMode, setIdentityMode] = useState<IdentityMode>("aliases");
  const [botMode, setBotMode] = useState<BotMode>("fill");
  const [directorStyle, setDirectorStyle] = useState<DirectorStyle>("dynamic");
  const [mode, setMode] = useState<GameMode>("scheduled");
  const [quickDayMinutes, setQuickDayMinutes] = useState<number>(8);
  const [quickNightMinutes, setQuickNightMinutes] = useState<number>(3);
  const [gender, setGender] = useState<Gender>("m");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    setMoreOpen(media.matches);
    const update = () => setMoreOpen(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function toggleDay(index: number) {
    setDays((current) => {
      if (current.includes(index)) {
        const next = current.filter((day) => day !== index);
        return next.length ? next : current;
      }
      return [...current, index].sort();
    });
  }

  function setPreset(start: string, end: string) {
    setDayStart(start);
    setDayEnd(end);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          realName: realName.trim(),
          gender,
          dayStart,
          dayEnd,
          days,
          rules: { seats, wolfCount, hasSeer, hasDoctor, identityMode, botMode, directorStyle, mode, quickDayMinutes, quickNightMinutes },
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        game?: { code: string };
        me?: { playerId: string; secret: string; fakeName: string };
      };
      if (!res.ok || data.error || !data.game) throw new Error(data.error ?? "לא הצלחנו לפתוח משחק");
      if (data.me) saveMe(data.game.code, data.me);
      router.push(`/admin/${data.game.code}`);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "לא הצלחנו לפתוח משחק");
    } finally {
      setBusy(false);
    }
  }

  function openExisting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === ROOM_CODE_LENGTH) router.push(`/admin/${code}`);
  }

  return (
    <main className="entry-page relative min-h-dvh overflow-x-clip text-paper">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[43%] lg:block">
        <Image src="/art/doctor.png" alt="" fill sizes="43vw" className="object-cover object-[45%_center] opacity-35" priority />
        <div className="absolute inset-0 bg-gradient-to-l from-night via-night/50 to-night/10" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-12 lg:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 rounded-xl text-sm font-bold text-paper/70 transition hover:text-paper">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5" aria-hidden="true">→</span>
            חזרה לעיירה
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-black">
            <Image src="/art/icon.png" alt="" width={32} height={32} className="h-8 w-8 rounded-[10px]" />
            AiYara
          </Link>
        </header>

        <div className="grid flex-1 items-start gap-8 py-8 lg:grid-cols-[.75fr_1.25fr] lg:items-center lg:gap-12 lg:py-10">
          <section className="order-2 max-w-lg lg:order-1">
            <div className="hidden lg:block">
              <p className="text-sm font-bold text-ember">אתם מנהלים</p>
              <h1 className="font-display mt-3 text-[1.9rem] sm:text-5xl">פותחים שולחן,<br />והכפר מתעורר.</h1>
              <p className="mt-5 text-base leading-7 text-paper/75 sm:text-lg sm:leading-8">
                אתם בוחרים כמה שחקנים, כמה זאבים ובאיזה קצב. הבמאי מנהל את הלילות ודואג שכל משחק ייצא אחר.
              </p>
            </div>

            <form onSubmit={openExisting} className="rounded-2xl border border-white/10 bg-white/[.04] p-4 lg:mt-8">
              <label htmlFor="existing-code" className="text-sm font-bold text-paper/65">חזרה לשולחן קיים</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="existing-code"
                  className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-center font-mono text-lg font-black tracking-[.25em] text-paper placeholder:text-paper/20 focus:border-ember/70 focus:outline-none"
                  placeholder="N7GHT2"
                  value={code}
                  onChange={(event) => setCode(cleanRoomCode(event.target.value))}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={ROOM_CODE_LENGTH}
                />
                <button type="submit" disabled={code.length !== ROOM_CODE_LENGTH} className="rounded-xl bg-white/10 px-5 font-black transition hover:bg-white/15 disabled:opacity-30">פתיחה</button>
              </div>
            </form>
          </section>

          <section className="entry-panel order-1 rounded-2xl border border-white/10 p-4 backdrop-blur-xl sm:rounded-[30px] sm:p-8 lg:order-2" aria-labelledby="create-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="create-title" className="font-display text-2xl">שולחן חדש</h2>
                <p className="mt-1 text-sm text-paper/50">הקוד יופיע מיד אחרי הפתיחה.</p>
              </div>
              <span className="rounded-full border border-ember/30 bg-ember/10 px-3 py-1 text-xs font-bold text-red-100">שעון ישראל</span>
            </div>

            <form id="create-game-form" onSubmit={create} className="mt-5 space-y-4 sm:mt-7 sm:space-y-6">
              <label className="block" htmlFor="host-name">
                <span className="text-sm font-bold text-paper/75">השם שלך</span>
                <input
                  id="host-name"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-base text-paper placeholder:text-paper/25 focus:border-ember/70 focus:outline-none"
                  placeholder="איך קוראים לך?"
                  value={realName}
                  onChange={(event) => setRealName(event.target.value.slice(0, 24))}
                  autoComplete="name"
                  maxLength={24}
                  required
                />
                <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="איך לפנות אליך">
                  {([["m", "פונים אליי בזכר"], ["f", "פונים אליי בנקבה"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={gender === id} onClick={() => setGender(id)} className={`min-h-12 rounded-xl border text-xs font-bold transition ${gender === id ? "border-paper/50 bg-paper/10 text-paper" : "border-white/10 bg-white/[.03] text-paper/50"}`}>{label}</button>
                  ))}
                </div>
              </label>

              <ChoiceGroup
                title="קצב המשחק"
                value={mode}
                onChange={(value) => setMode(value as GameMode)}
                options={[
                  ["scheduled", "מתמשך", "יום אחד בכל יום, לפי שעות העיירה"],
                  ["quick", "מהיר", "כל המשחק בישיבה אחת, בדקות"],
                ]}
              />

              {mode === "quick" && (
                <fieldset>
                  <legend className="text-sm font-bold text-paper/75">אורך היום והלילה</legend>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                      <span className="text-paper/50">יום (דקות)</span>
                      <select value={quickDayMinutes} onChange={(event) => setQuickDayMinutes(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl bg-white/10 px-3 text-base font-black text-paper">
                        {QUICK_DAY_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                      <span className="text-paper/50">לילה (דקות)</span>
                      <select value={quickNightMinutes} onChange={(event) => setQuickNightMinutes(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl bg-white/10 px-3 text-base font-black text-paper">
                        {QUICK_NIGHT_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-paper/40">הבוטים מדברים בקצב של קבוצה חיה. שולחן של 8 עם יום של 8 דקות נגמר בדרך כלל תוך 30–50 דקות.</p>
                </fieldset>
              )}

              <fieldset>
                <legend className="text-sm font-bold text-paper/75">הרכב העיירה</legend>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                    <span className="text-paper/50">שחקנים</span>
                    <select
                      value={seats}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setSeats(next);
                        setWolfCount((current) => Math.min(current, Math.floor((next - 1) / 2)));
                      }}
                      className="mt-2 min-h-12 w-full rounded-xl bg-white/10 px-3 text-base font-black text-paper"
                    >
                      {Array.from({ length: 8 }, (_, index) => index + 5).map((count) => <option key={count} value={count}>{count}</option>)}
                    </select>
                  </label>
                  <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                    <span className="text-paper/50">זאבים</span>
                    <select value={wolfCount} onChange={(event) => setWolfCount(Number(event.target.value))} className="mt-2 min-h-12 w-full rounded-xl bg-white/10 px-3 text-base font-black text-paper">
                      {Array.from({ length: Math.floor((seats - 1) / 2) }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>

              <details open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} className="group rounded-2xl border border-white/10 bg-black/10 lg:rounded-none lg:border-0 lg:bg-transparent">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-paper/80 marker:hidden lg:px-0 lg:pt-0 [&::-webkit-details-marker]:hidden">
                  <span>עוד הגדרות <span className="font-normal text-paper/40">· {identityMode === "aliases" ? "שמות בדויים" : "שמות אמיתיים"} · {botMode === "fill" ? "חברים + AI" : "אנשים בלבד"} · {directorStyle === "dynamic" ? "דינמי" : directorStyle === "classic" ? "קלאסי" : "פרוע"}</span></span>
                  <span aria-hidden="true" className="text-lg text-paper/45 transition group-open:rotate-180">⌄</span>
                </summary>
                <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-4 sm:space-y-6 lg:border-0 lg:px-0 lg:pb-0">
                  <div className="grid grid-cols-2 gap-2">
                    <ToggleButton active={hasSeer} onClick={() => setHasSeer((value) => !value)} label="רואה" detail="בודק תפקיד בלילה" />
                    <ToggleButton active={hasDoctor} onClick={() => setHasDoctor((value) => !value)} label="רופא" detail="מציל קורבן בלילה" />
                  </div>

              <ChoiceGroup
                title="זהויות"
                value={identityMode}
                onChange={(value) => setIdentityMode(value as IdentityMode)}
                options={[
                  ["aliases", "שמות בדויים", "כולם נכנסים לדמות"],
                  ["real", "שמות אמיתיים", "יודעים מי סביב השולחן"],
                ]}
              />

              <ChoiceGroup
                title="מי משחק?"
                value={botMode}
                onChange={(value) => setBotMode(value as BotMode)}
                options={[
                  ["fill", "חברים + AI", "הבוטים משלימים מקומות"],
                  ["humans_only", "אנשים בלבד", "מתחילים כשהשולחן מלא"],
                ]}
              />

              <ChoiceGroup
                title="סגנון הבמאי"
                value={directorStyle}
                onChange={(value) => setDirectorStyle(value as DirectorStyle)}
                options={[
                  ["classic", "קלאסי", "בלי הפתעות מכניות"],
                  ["dynamic", "דינמי", "רמזים ושיבושים מאוזנים"],
                  ["wild", "פרוע", "גם לילות עם קורבן נוסף"],
                ]}
              />

              {mode === "scheduled" && (<>
              <fieldset>
                <legend className="text-sm font-bold text-paper/75">מתי העיירה פתוחה?</legend>
                <p className="mt-1 text-xs leading-5 text-paper/40">בשעות היום מדברים ומצביעים. בלילה בעלי התפקידים פועלים.</p>
                <div className="mt-3 flex gap-2">
                  {[["יום מלא", "10:00", "22:00"], ["ערב", "19:00", "23:00"]].map(([label, start, end]) => {
                    const active = dayStart === start && dayEnd === end;
                    return <button key={label} type="button" onClick={() => setPreset(start, end)} aria-pressed={active} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${active ? "border-ember/60 bg-ember/15 text-paper" : "border-white/10 bg-white/5 text-paper/50 hover:text-paper"}`}>{label}</button>;
                  })}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-paper/50">פתיחה</span>
                    <select value={dayStart} onChange={(event) => setDayStart(event.target.value)} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-3 text-base text-paper focus:border-ember/70 focus:outline-none" required>
                      {HOUR_OPTIONS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="text-paper/50">סגירה</span>
                    <select value={dayEnd} onChange={(event) => setDayEnd(event.target.value)} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-3 text-base text-paper focus:border-ember/70 focus:outline-none" required>
                      {HOUR_OPTIONS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-sm font-bold text-paper/75">ימי משחק</legend>
                <div className="mt-3 grid grid-cols-7 gap-1.5">
                  {WEEKDAY_CHIPS.map((day) => {
                    const active = days.includes(day.i);
                    return (
                      <button
                        key={day.i}
                        type="button"
                        onClick={() => toggleDay(day.i)}
                        aria-pressed={active}
                        aria-label={`יום ${day.l}`}
                        className={`flex min-h-10 items-center justify-center rounded-xl text-sm font-black transition sm:aspect-square sm:min-h-0 sm:text-base ${active ? "bg-paper text-ink" : "border border-white/10 bg-white/5 text-paper/35 hover:text-paper"}`}
                      >
                        {day.l}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              </>)}
                </div>
              </details>

              {err && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

              <button type="submit" disabled={busy || !realName.trim()} className="sticky bottom-0 z-10 min-h-14 w-full rounded-2xl border-t border-white/10 bg-ember/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-lg font-black text-white shadow-[0_14px_35px_rgba(133,27,24,.3)] backdrop-blur-xl transition lg:static lg:border-0 lg:bg-ember lg:p-0 hover:bg-[#e65346] disabled:cursor-not-allowed disabled:opacity-35">
                {busy ? "פותחים את העיירה…" : "פתיחת משחק"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}

function ToggleButton({ active, onClick, label, detail }: { active: boolean; onClick: () => void; label: string; detail: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-2xl border min-h-12 p-3 text-right transition ${active ? "border-ember/60 bg-ember/15" : "border-white/10 bg-white/[.03] opacity-55"}`}>
      <span className="block font-black">{active ? "✓ " : ""}{label}</span>
      <span className="mt-1 block text-xs text-paper/45">{detail}</span>
    </button>
  );
}

function ChoiceGroup({ title, value, onChange, options }: { title: string; value: string; onChange: (value: string) => void; options: [string, string, string][] }) {
  return (
    <fieldset>
      <legend className="text-sm font-bold text-paper/75">{title}</legend>
      <div className={`mt-3 grid gap-2 ${options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {options.map(([id, label, detail]) => (
          <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={value === id} className={`rounded-2xl border min-h-12 p-3 text-right transition ${value === id ? "border-paper/50 bg-paper/10" : "border-white/10 bg-white/[.03] text-paper/55"}`}>
            <span className="block text-sm font-black">{label}</span>
            <span className="mt-1 block text-[11px] leading-4 text-paper/40">{detail}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

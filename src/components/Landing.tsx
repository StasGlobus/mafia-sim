import Link from "next/link";

export default function Landing() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-night text-paper">
      <img
        src="/art/hero.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-night" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-10 pt-16">
        <div className="flex items-center gap-3">
          <img src="/art/icon.png" alt="" className="h-12 w-12 rounded-2xl object-cover" />
          <div className="text-sm text-dust">לילה בכפר</div>
        </div>
        <h1 className="mt-10 text-6xl font-extrabold leading-none tracking-tight">מאפיה</h1>
        <p className="mt-4 text-2xl font-bold text-paper/90">8 שמות. מי הזאב.</p>
        <ol className="mt-10 space-y-3 text-base text-paper/85">
          <li className="rounded-2xl bg-black/35 px-4 py-3 backdrop-blur-sm">יום — צ&apos;אט פתוח. מצביעים. רוב תולים.</li>
          <li className="rounded-2xl bg-black/35 px-4 py-3 backdrop-blur-sm">לילה — זאב הורג. רואה בודק. רופא שומר.</li>
          <li className="rounded-2xl bg-black/35 px-4 py-3 backdrop-blur-sm">נכנסים עם שם. מקבלים שם אחר בכפר.</li>
        </ol>
        <div className="mt-auto space-y-3 pt-10">
          <Link
            href="/play"
            className="flex min-h-14 items-center justify-center rounded-2xl bg-paper text-xl font-extrabold text-ink active:opacity-80"
          >
            שחק עם חברים
          </Link>
          <Link
            href="/sim"
            className="flex min-h-12 items-center justify-center rounded-2xl bg-white/10 text-base font-bold text-paper/90 active:opacity-80"
          >
            רק לצפות בבוטים
          </Link>
        </div>
      </div>
    </div>
  );
}

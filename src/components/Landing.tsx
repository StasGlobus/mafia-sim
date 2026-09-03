import Image from "next/image";
import Link from "next/link";

const roles = [
  { name: "זאב", detail: "מטעה ביום. צד בלילה.", art: "/art/wolf.png", tone: "text-ember" },
  { name: "רואה", detail: "מגלה אמת אחת בכל לילה.", art: "/art/seer.png", tone: "text-paper" },
  { name: "רופא", detail: "יכול להציל מישהו מהלהקה.", art: "/art/doctor.png", tone: "text-paper" },
  { name: "תושב", detail: "קורא אנשים. מצביע. שורד.", art: "/art/villager.png", tone: "text-paper" },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5m6-6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Zm6.5 11 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5 14l.8 2.7 2.7.8-2.7.8L5 21l-.8-2.7-2.7-.8 2.7-.8L5 14Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Landing() {
  return (
    <main className="landing relative min-h-dvh overflow-x-clip bg-night text-paper">
      <Image
        src="/art/hero.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="landing-hero object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,7,7,.97)_0%,rgba(8,7,7,.84)_43%,rgba(8,7,7,.2)_100%)] max-lg:bg-[linear-gradient(180deg,rgba(8,7,7,.25)_0%,rgba(8,7,7,.82)_46%,#080707_78%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_10%,rgba(190,38,33,.2),transparent_32%)]" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 lg:px-12 lg:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-3 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <Image src="/art/icon.png" alt="" width={48} height={48} className="h-11 w-11 rounded-[14px] object-cover ring-1 ring-white/15 transition-transform group-hover:scale-105" />
            <div>
              <div className="font-display text-lg leading-none">AiYara</div>
              <div className="mt-1 text-[11px] font-medium tracking-[.14em] text-paper/55">העיירה לא נרדמת</div>
            </div>
          </Link>
          <Link href="/sim" className="hidden items-center gap-2 rounded-full border border-white/15 bg-black/25 px-4 py-2.5 text-sm font-bold text-paper/75 backdrop-blur transition hover:border-white/30 hover:bg-white/10 hover:text-paper sm:flex">
            <SparkIcon />
            צפו במשחק לדוגמה
          </Link>
        </header>

        <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(430px,.95fr)] lg:py-10">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-ember/30 bg-ember/10 px-3 py-1.5 text-xs font-bold text-red-100 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-ember" />
              </span>
              5 עד 12 שחקנים. אנשים ובוטים באותו שולחן
            </div>
            <h1 className="font-display max-w-xl text-[2.5rem] sm:text-6xl lg:text-[4.6rem]">
              אחד מהחברים שלכם
              <br />
              <span className="text-ember">הוא זאב.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base font-medium leading-7 text-paper/80 sm:text-xl sm:leading-8">
              ביום מדברים ומצביעים, בלילה מישהו נעלם. אפשר לסגור משחק בחצי שעה, או למשוך אותו כמה ימים בקבוצה. חסרים שחקנים? בוטים מתיישבים במקומות הריקים, וקשה לדעת מי מהם.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:max-w-xl sm:flex-row">
              <Link href="/play" className="group flex min-h-16 flex-1 items-center justify-between rounded-2xl bg-paper px-5 text-lg font-black text-ink shadow-[0_14px_40px_rgba(0,0,0,.3)] transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ember active:translate-y-0">
                <span className="flex items-center gap-3"><PeopleIcon /> הצטרפות למשחק</span>
                <span className="transition-transform group-hover:-translate-x-1"><ArrowIcon /></span>
              </Link>
              <Link href="/admin" className="group flex min-h-16 flex-1 items-center justify-between rounded-2xl border border-white/15 bg-white/[.08] px-5 text-lg font-black text-paper backdrop-blur transition hover:-translate-y-0.5 hover:border-ember/50 hover:bg-ember/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember active:translate-y-0">
                <span>פתיחת שולחן חדש</span>
                <span className="text-paper/60 transition-transform group-hover:-translate-x-1"><ArrowIcon /></span>
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-paper/65">
              <span>בלי להתקין כלום</span><span className="h-1 w-1 rounded-full bg-paper/25" />
              <span>לכל אחד שם אחר בעיירה</span><span className="h-1 w-1 rounded-full bg-paper/25" />
              <span>אפשר גם לבד מול הבוטים</span>
            </div>

            <div className="role-strip mt-8 lg:hidden">
              {roles.map((role) => (
                <div key={role.name} className="relative h-40 overflow-hidden rounded-2xl border border-white/10">
                  <Image src={role.art} alt="" fill sizes="46vw" className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                  <div className={`absolute inset-x-0 bottom-0 p-3 font-display text-lg ${role.tone}`}>{role.name}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative hidden min-h-[560px] lg:block" aria-label="הדמויות במשחק">
            <div className="absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ember/20 bg-ember/[.07] shadow-[0_0_100px_rgba(190,38,33,.17)]" />
            <div className="absolute inset-5 grid rotate-[-2deg] grid-cols-2 gap-4">
              {roles.map((role, index) => (
                <div key={role.name} className={`role-card group relative overflow-hidden rounded-[28px] border border-white/10 bg-black/45 shadow-2xl backdrop-blur ${index % 2 ? "translate-y-8" : "-translate-y-2"}`}>
                  <Image src={role.art} alt="" fill sizes="240px" className="object-cover transition duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className={`font-display text-2xl ${role.tone}`}>{role.name}</div>
                    <p className="mt-1 text-xs font-medium text-paper/65">{role.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-2 border-t border-white/10 pt-5 sm:grid-cols-3" aria-label="איך משחקים">
          {[
            ["01", "נכנסים עם קוד", "מקבלים שם אחר ותפקיד סודי."],
            ["02", "מדברים ומצביעים", "מי שמקבל רוב יוצא מהמשחק."],
            ["03", "עוברים את הלילה", "הזאבים צדים, הרואה והרופא פועלים."],
          ].map(([n, title, detail]) => (
            <div key={n} className="flex items-start gap-3 rounded-2xl px-2 py-2 sm:px-3">
              <span className="font-mono text-xs font-bold text-ember">{n}</span>
              <div><h2 className="text-sm font-extrabold">{title}</h2><p className="mt-1 text-xs leading-5 text-paper/50">{detail}</p></div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

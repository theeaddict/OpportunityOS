import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { getDashboard } from '@/lib/repositories/dashboard';
import * as accountsRepo from '@/lib/repositories/accounts';
import DashboardCards from '@/components/DashboardCards';
import { OpportunityFeed } from '@/components/OpportunityFeedCard';

export const dynamic = 'force-dynamic';

function IconSearch(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function IconDoc(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  );
}
function IconChart(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}
function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}
function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const STEPS = [
  { n: '01', title: 'Discover', body: 'Find real, verifiable businesses by industry and location — not a fabricated list.', Icon: IconSearch },
  { n: '02', title: 'Research', body: 'Evidence gathered only from what a business actually publishes. No claim without a source.', Icon: IconDoc },
  { n: '03', title: 'Score', body: 'Every opportunity scored 0–100 across 8 transparent factors, with a plain-English reason for each.', Icon: IconChart },
  { n: '04', title: 'Reach out', body: 'Personalized, evidence-based outreach — reviewed and approved by you before anything is sent.', Icon: IconSend },
];

const PRINCIPLES = [
  'Every claim carries a source, a URL and a confidence score — nothing is shown as fact unless it’s verified.',
  'Weak evidence gets rejected, not spun into a pitch. The system says no rather than invent an opportunity.',
  'Outreach is never sent automatically. You review and approve every message before it goes out.',
];

const FAQS = [
  { q: 'Do I need a credit card to start?', a: 'No. The Free plan requires nothing — register and start finding opportunities right away.' },
  { q: 'Where does the data come from?', a: 'Public business listings and each business’s own published website. Nothing is invented — if there’s no evidence, the platform says so instead of guessing.' },
  { q: 'Can I cancel anytime?', a: 'Yes, from your account page — no lock-in, no calls required.' },
];

function formatPrice(cents, currency) {
  if (cents == null) return 'Custom';
  if (cents === 0) return 'Free';
  return `${(cents / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 })}`;
}

function planFeatures(p) {
  const line = (n, label) => `${n == null ? 'Unlimited' : n} ${label}`;
  return [
    line(p.limit_researches, 'business discoveries / mo'),
    line(p.limit_opportunities, 'opportunities / mo'),
    line(p.limit_ai_analyses, 'AI analyses / mo'),
    line(p.limit_users, 'team seats'),
  ];
}

// Unauthenticated visitors used to be bounced straight to /login with zero
// information about the product. A public visitor here can't sign in to see
// value — this is the only place they can evaluate it first.
async function LandingPage() {
  const plans = (await accountsRepo.listPlans()).filter((p) => p.is_active && p.code !== 'internal');
  const highlightCode = plans.length > 1 ? plans.find((p) => p.price_cents > 0)?.code : null;

  return (
    <div className="bg-white">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <p className="whitespace-nowrap text-lg font-bold tracking-tight sm:text-xl"><span className="text-blue-700">Opportunity</span>OS</p>
          <nav className="flex shrink-0 items-center gap-3 sm:gap-5">
            <Link href="/login" className="whitespace-nowrap text-sm font-medium text-gray-600 hover:text-gray-900">Log in</Link>
            <Link
              href="/register"
              className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 sm:px-4"
            >
              Get started free
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-slate-900 px-4 py-20 text-center text-white sm:px-6 sm:py-28">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(16,185,129,0.22), transparent)' }}
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="mx-auto mb-5 inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-300">
            Evidence-based — not AI guesswork
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Stop searching for customers.<br className="hidden sm:block" /> Start with the money.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-slate-300 sm:text-lg">
            OpportunityOS researches real businesses and shows you where a money-making opportunity is worth
            pursuing — with the evidence, the impact, and exactly how to approach it.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/register"
              className="rounded-xl bg-emerald-500 px-7 py-3.5 text-base font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
            >
              Get started free →
            </Link>
            <Link href="/login" className="text-sm font-medium text-slate-300 underline underline-offset-4 hover:text-white">
              Already have an account? Log in
            </Link>
          </div>
          <p className="mt-8 text-xs text-slate-400">No credit card required · Free plan included</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700">How it works</h2>
          <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">From a blank search to a ranked, approved lead</p>
        </div>
        <div className="relative mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-gray-200 lg:block" />
          {STEPS.map(({ n, title, body, Icon }) => (
            <div key={title} className="relative text-center">
              <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white text-blue-700 shadow-sm">
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-4 text-xs font-semibold tracking-widest text-gray-400">{n}</p>
              <h3 className="mt-1 text-base font-semibold text-gray-900">{title}</h3>
              <p className="mt-1.5 text-sm text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700">Why the numbers hold up</h2>
            <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Built to say no, not to impress you</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {PRINCIPLES.map((text) => (
              <div key={text} className="rounded-2xl border border-gray-200 bg-white p-6">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <IconCheck className="h-4 w-4" />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-gray-700">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {plans.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700">Plans</h2>
            <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Start free. Upgrade when it&apos;s working.</p>
          </div>
          <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
            {plans.map((p) => {
              const featured = p.code === highlightCode;
              return (
                <div
                  key={p.code}
                  className={`relative rounded-2xl border p-7 ${featured ? 'border-slate-900 bg-slate-900 text-white shadow-xl' : 'border-gray-200 bg-white'}`}
                >
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-900">
                      Most popular
                    </span>
                  )}
                  <p className={`text-sm font-semibold uppercase tracking-wide ${featured ? 'text-slate-300' : 'text-gray-500'}`}>{p.name}</p>
                  <p className="mt-2 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{formatPrice(p.price_cents, p.currency)}</span>
                    {p.price_cents > 0 && <span className={featured ? 'text-slate-400' : 'text-gray-400'}>/mo</span>}
                  </p>
                  {p.description && <p className={`mt-2 text-sm ${featured ? 'text-slate-300' : 'text-gray-600'}`}>{p.description}</p>}
                  <ul className="mt-6 space-y-2.5 text-left text-sm">
                    {planFeatures(p).map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <IconCheck className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-emerald-400' : 'text-emerald-600'}`} />
                        <span className={featured ? 'text-slate-200' : 'text-gray-700'}>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/register"
                    className={`mt-7 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                      featured ? 'bg-emerald-500 text-slate-900 hover:bg-emerald-400' : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    Get started
                  </Link>
                </div>
              );
            })}
          </div>
          <p className="mt-8 text-center text-xs italic text-gray-400">
            Every claim carries a source. Financial figures are illustrative estimates, never quoted as facts.
          </p>
        </section>
      )}

      <section className="border-t border-gray-200 bg-gray-50 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-center text-2xl font-bold tracking-tight text-gray-900">Questions</h2>
          <div className="mt-10 space-y-6">
            {FAQS.map(({ q, a }) => (
              <div key={q} className="rounded-xl border border-gray-200 bg-white p-5">
                <p className="text-sm font-semibold text-gray-900">{q}</p>
                <p className="mt-1.5 text-sm text-gray-600">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 py-8 text-center text-xs text-gray-400">
        <p><span className="font-semibold text-gray-500">OpportunityOS</span> — Business Opportunity Intelligence</p>
      </footer>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return <LandingPage />;

  const { metrics, feed } = await getDashboard(user.account_id, user.role === 'member' ? user.id : null);

  return (
    <>
      <section className="mb-8 rounded-2xl bg-slate-900 px-6 py-8 text-white sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Stop searching for customers. Start with the money.
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              OpportunityOS researches real businesses and shows you where a money-making opportunity is worth
              pursuing — with the evidence, the impact, and exactly how to approach it. No more hunting for leads
              all day.
            </p>
          </div>
          <Link
            href="/discover"
            className="shrink-0 rounded-xl bg-emerald-500 px-6 py-3 text-center text-base font-semibold text-slate-900 shadow hover:bg-emerald-400"
          >
            Find opportunities
          </Link>
        </div>
        <p className="mt-4 text-xs italic text-slate-400">
          Welcoming {user.name.split(' ')[0]} — here&apos;s the money at stake across everything you&apos;ve found so far.
        </p>
      </section>

      <DashboardCards metrics={metrics} />

      <div className="mb-3 mt-8 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Money-making opportunities</h2>
          <p className="mt-0.5 text-xs text-gray-400">Evidence-backed problems, ranked by impact and confidence.</p>
        </div>
        <Link href="/opportunities" className="text-xs font-medium text-blue-600 hover:underline">View all →</Link>
      </div>
      <OpportunityFeed feed={feed} />

      <p className="mt-6 text-xs italic text-gray-400">
        Business-impact and delivery-value figures are illustrative estimates from your assumptions and the solution
        library — never quoted as facts.
      </p>
    </>
  );
}

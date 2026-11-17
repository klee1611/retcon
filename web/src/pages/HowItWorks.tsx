import type { ReactNode } from "react"

import { Tabs } from "@/components/Tabs"

const GITHUB = "https://github.com/klee1611/retcon"

function H({ children }: { children: ReactNode }) {
  return <h3 className="text-xl font-semibold tracking-tight">{children}</h3>
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-muted-foreground">{children}</p>
}

const writePath = [
  {
    name: "Source policy",
    text: "Rules based on where the content came from. For example, a product review is marked as an untrusted source.",
  },
  {
    name: "Attack-pattern search",
    text: "The candidate memory is compared by vector similarity with known attack patterns stored in MongoDB Atlas (Vector Search, Automated Embeddings, voyage-4).",
  },
  {
    name: "Per-source trust",
    text: "Each source has a trust score that reflects how many of its writes were blocked or clean.",
  },
  {
    name: "Quarantine or store",
    text: "A suspicious write is held in quarantine instead of becoming a memory. A person can release it or discard it.",
  },
]

function AiTab() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <H>Memory poisoning</H>
        <P>
          An agent with long-term memory reads content it does not control: a product review, an email, documentation.
          If that content contains a hidden instruction and the agent saves it as a memory, the instruction is now
          part of what the agent believes. Later, an ordinary request reads that memory and the agent acts on it. In
          the shopping demo, a refund goes to the attacker&apos;s account.
        </P>
      </section>

      <section className="space-y-4">
        <H>The write path</H>
        <P>Every memory write goes through these checks before it is stored.</P>
        <ol className="grid gap-3 md:grid-cols-2">
          {writePath.map((s, i) => (
            <li key={s.name} className="rounded-lg border bg-card p-4">
              <p className="text-sm font-semibold">
                <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                {s.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
        <P>
          If a check cannot run, the write is quarantined rather than allowed (fail closed). A quarantined item records
          which rule held it and why.
        </P>
      </section>

      <section className="space-y-3">
        <H>Rollback</H>
        <P>
          Retcon keeps the full history of memory changes. Pick any event on the timeline, preview the difference, and
          confirm. The state returns to just before that event, and everything after it is undone. The rollback itself
          is recorded on the timeline, so it can be rolled back too.
        </P>
      </section>
    </div>
  )
}

const threats = [
  {
    scenario: "Shopping assistant",
    attacker: "Anyone who can post a product review",
    entry: "Product review",
    impact: "Refunds go to the attacker's account",
  },
  {
    scenario: "Email assistant (coming soon)",
    attacker: "Anyone who can send an email",
    entry: "Incoming email",
    impact: "Email is sent to an unknown recipient",
  },
  {
    scenario: "Coding assistant (coming soon)",
    attacker: "Anyone who can publish technical docs",
    entry: "Technical documentation",
    impact: "A package is installed from an unapproved registry (supply chain)",
  },
]

const mitigation =
  "Source policy, attack-pattern vector search, per-source trust, quarantine of suspicious writes, and rollback."

const limitations = [
  "Keyword rules can be evaded by rewording the instruction.",
  "The similarity threshold needs tuning: lower it and more attacks are caught but more normal text is held, raise it and the reverse.",
  "Failing closed is a tradeoff: when a check cannot run, a harmless write may be quarantined instead of stored.",
]

function SecurityTab() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <H>Threat model</H>
        <div className="hidden overflow-hidden rounded-lg border md:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Threat model by scenario</caption>
            <thead className="bg-muted/60">
              <tr>
                {["Scenario", "Attacker", "Entry point", "Impact", "Mitigation"].map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {threats.map((t) => (
                <tr key={t.scenario} className="border-t align-top">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {t.scenario}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{t.attacker}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.entry}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.impact}</td>
                  <td className="px-4 py-3 text-muted-foreground">{mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {threats.map((t) => (
            <li key={t.scenario} className="rounded-lg border bg-card p-4 text-sm">
              <p className="font-semibold">{t.scenario}</p>
              <dl className="mt-2 space-y-2">
                {(
                  [
                    ["Attacker", t.attacker],
                    ["Entry point", t.entry],
                    ["Impact", t.impact],
                    ["Mitigation", mitigation],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <H>Known limitations</H>
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-muted-foreground">
          {limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const collections = ["memories", "quarantine", "memory_history", "sources", "actions", "sessions", "attack_patterns"]

function Box({ title, children, strong }: { title: string; children?: ReactNode; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${strong ? "border-primary bg-primary/5" : "bg-card"}`}>
      <p className="text-sm font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  )
}

function Arrow() {
  return (
    <div aria-hidden className="flex justify-center text-muted-foreground">
      <svg width="16" height="24" viewBox="0 0 16 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v18M3 15l5 5 5-5" />
      </svg>
    </div>
  )
}

function BackendTab() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <H>Architecture</H>
        <figure className="max-w-xl space-y-0">
          <div role="img" aria-label="React SPA calls FastAPI on Vercel Functions, which uses RetconStore, which stores data in MongoDB Atlas collections" className="space-y-1">
            <Box title="React SPA">The browser app you are using now.</Box>
            <Arrow />
            <Box title="FastAPI on Vercel Functions">JSON API under /api.</Box>
            <Arrow />
            <Box title="RetconStore" strong>
              A subclass of LangGraph&apos;s MongoDBStore. Every memory write goes through the checks.
            </Box>
            <Arrow />
            <Box title="MongoDB Atlas">
              <ul className="mt-2 flex flex-wrap gap-2">
                {collections.map((c) => (
                  <li key={c} className="rounded border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                    {c}
                  </li>
                ))}
              </ul>
            </Box>
          </div>
          <figcaption className="pt-3 text-sm text-muted-foreground">
            attack_patterns is searched with Atlas Vector Search.
          </figcaption>
        </figure>
      </section>

      <section className="space-y-3">
        <H>Design notes</H>
        <ul className="max-w-3xl list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            Session isolation: each visitor gets their own session, identified by an HttpOnly cookie, and the session
            expires after 24 hours.
          </li>
          <li>One request per session at a time. A second concurrent write gets a 409 session_busy response.</li>
          <li>
            No SSE or websockets. Every response returns the full current state, and the client replaces its copy.
          </li>
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        Read the code on{" "}
        <a
          href={GITHUB}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  )
}

export function HowItWorks() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h1>
        <p className="max-w-2xl text-muted-foreground">
          Retcon sits between an agent and its memory. Pick a layer to read about.
        </p>
      </div>
      <Tabs
        label="How it works"
        tabs={[
          { id: "ai", label: "AI", content: <AiTab /> },
          { id: "security", label: "Security", content: <SecurityTab /> },
          { id: "backend", label: "Backend", content: <BackendTab /> },
        ]}
      />
    </div>
  )
}

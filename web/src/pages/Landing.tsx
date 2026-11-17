import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"

import { AttackStory } from "@/components/AttackStory"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getHealth, listScenarios } from "@/lib/api"
import { cn } from "@/lib/utils"

type Status = "checking" | "online" | "offline"

type ScenarioCard = {
  id: string
  name: string
  tagline: string
  attack: string
  available: boolean
}

/** Built-in content: the landing page must render fully when the API is offline. */
const STATIC_SCENARIOS: ScenarioCard[] = [
  {
    id: "shopping",
    name: "Shopping assistant",
    tagline: "A store assistant that remembers where your refunds go.",
    attack: "Attack: a product review makes the assistant refund to the attacker's account.",
    available: true,
  },
  {
    id: "email",
    name: "Email assistant",
    tagline: "An assistant that reads and sends email for you.",
    attack: "Attack: an incoming email makes the assistant send mail to an unknown recipient.",
    available: false,
  },
  {
    id: "coding",
    name: "Coding assistant",
    tagline: "An assistant that helps set up and run your projects.",
    attack: "Attack: technical docs make the assistant install a package from an unapproved registry (supply chain).",
    available: false,
  },
]

/** Prefer live names/taglines/availability from the API; keep static attack lines. */
function mergeScenarios(live: { id: string; name: string; tagline?: string; available: boolean }[]) {
  return STATIC_SCENARIOS.map((s) => {
    const l = live.find((x) => x.id === s.id)
    if (!l) return s
    return { ...s, name: l.name || s.name, tagline: l.tagline || s.tagline, available: l.available }
  })
}

export function Landing() {
  const [status, setStatus] = useState<Status>("checking")
  const [scenarios, setScenarios] = useState<ScenarioCard[]>(STATIC_SCENARIOS)

  useEffect(() => {
    const ctrl = new AbortController()
    getHealth(ctrl.signal)
      .then((h) => setStatus(h.ok ? "online" : "offline"))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          console.warn("health check failed", err)
          setStatus("offline")
        }
      })
    listScenarios(ctrl.signal)
      .then((list) => setScenarios(mergeScenarios(list)))
      .catch(() => {
        /* keep static content */
      })
    return () => ctrl.abort()
  }, [])

  return (
    <div className="space-y-20 sm:space-y-28">
      <section className="space-y-6">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          One poisoned memory can hijack your AI agent.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          An agent with long-term memory reads untrusted content, and a hidden instruction can end up saved as a
          memory. Retcon is a memory firewall and an undo button: it checks every memory write, quarantines the
          suspicious ones, and keeps full history so any change can be rolled back.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/play/shopping">
              Try the shopping demo <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/how-it-works">How it works</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="story-heading" className="space-y-6">
        <h2 id="story-heading" className="text-2xl font-semibold tracking-tight">
          The attack, and the undo
        </h2>
        <AttackStory />
      </section>

      <section aria-labelledby="scenarios-heading" className="space-y-6">
        <h2 id="scenarios-heading" className="text-2xl font-semibold tracking-tight">
          Pick a scenario
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {scenarios.map((s) => (
            <li key={s.id}>
              <ScenarioCardView scenario={s} />
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="teaser-heading"
        className="space-y-4 rounded-lg border bg-muted/40 p-6 sm:p-8"
      >
        <h2 id="teaser-heading" className="text-2xl font-semibold tracking-tight">
          How Retcon works
        </h2>
        <p className="max-w-2xl text-muted-foreground">
          Every memory write passes a source policy, a vector search against known attack patterns in MongoDB Atlas,
          and a per-source trust check. Anything suspicious is held in quarantine, and every change is recorded so
          it can be rolled back.
        </p>
        <Button asChild variant="outline">
          <Link to="/how-it-works">
            Read how it works <ArrowRight aria-hidden />
          </Link>
        </Button>
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 rounded-full",
            status === "online" && "bg-success",
            status === "offline" && "bg-danger",
            status === "checking" && "bg-muted-foreground",
          )}
        />
        <span role="status">{status === "checking" ? "API: checking…" : `API: ${status}`}</span>
      </p>
    </div>
  )
}

function ScenarioCardView({ scenario: s }: { scenario: ScenarioCard }) {
  const body = (
    <Card
      className={cn(
        "h-full",
        s.available ? "transition-colors hover:border-primary" : "opacity-80",
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{s.name}</CardTitle>
          {s.available ? null : (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">Coming soon</span>
          )}
        </div>
        <CardDescription>{s.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{s.attack}</p>
        {s.available ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            Try it <ArrowRight aria-hidden className="size-4" />
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
  if (!s.available) return body
  return (
    <Link
      to={`/play/${s.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {body}
    </Link>
  )
}

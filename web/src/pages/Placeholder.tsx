import { useParams } from "react-router-dom"

function Page({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{children ?? "Coming soon."}</p>
    </div>
  )
}

export function Play() {
  const { scenario } = useParams<{ scenario: string }>()
  return <Page title="Playground">Scenario: {scenario}</Page>
}
export const Eval = () => <Page title="Eval" />
export const NotFound = () => <Page title="Not found">That page does not exist.</Page>

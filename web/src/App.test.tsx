import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import App from "@/App"

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

function mockFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl))
}

afterEach(() => vi.unstubAllGlobals())

describe("layout", () => {
  it("renders brand, nav links and theme toggle", () => {
    mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
    renderAt("/how-it-works")
    expect(screen.getByRole("link", { name: "Retcon" })).toHaveAttribute("href", "/")
    const nav = screen.getByRole("navigation", { name: "Main" })
    expect(nav).toHaveTextContent("Play")
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works")
    expect(screen.getByRole("link", { name: "Eval" })).toHaveAttribute("href", "/eval")
    expect(screen.getByRole("button", { name: /switch to/i })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument()
  })
})

describe("health status", () => {
  it("shows online when the API responds ok (extra fields tolerated)", async () => {
    mockFetch(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, version: "1" }) }),
    )
    renderAt("/")
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("API: online"))
  })

  it("shows offline when the request fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockFetch(() => Promise.reject(new Error("network")))
    renderAt("/")
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("API: offline"))
  })
})

describe("landing (API offline)", () => {
  it("renders CTA and three scenario cards from built-in content", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mockFetch(() => Promise.reject(new TypeError("offline")))
    renderAt("/")
    const cta = screen.getByRole("link", { name: /try the shopping demo/i })
    expect(cta).toHaveAttribute("href", "/play/shopping")
    expect(screen.getByRole("heading", { name: "Shopping assistant" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Email assistant" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Coding assistant" })).toBeInTheDocument()
    expect(screen.getAllByText("Coming soon")).toHaveLength(2)
    expect(screen.getByRole("link", { name: /shopping assistant/i })).toHaveAttribute("href", "/play/shopping")
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("API: offline"))
  })
})

describe("how it works tabs", () => {
  it("switches panels by click and keyboard", async () => {
    const user = userEvent.setup()
    renderAt("/how-it-works")
    const ai = screen.getByRole("tab", { name: "AI" })
    expect(ai).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "Memory poisoning" })).toBeVisible()

    await user.click(screen.getByRole("tab", { name: "Security" }))
    expect(screen.getByRole("heading", { name: "Known limitations" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Memory poisoning" })).not.toBeInTheDocument()

    screen.getByRole("tab", { name: "Security" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Backend" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "Architecture" })).toBeVisible()
  })
})

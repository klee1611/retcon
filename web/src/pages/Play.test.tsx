import { StrictMode } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api"
import { BackendContext } from "@/lib/backend"
import { createMockBackend, type MockBackend } from "@/mocks/mockBackend"
import { Play } from "@/pages/Play"

type User = ReturnType<typeof userEvent.setup>

function setViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

async function setup(path = "/play/shopping", strict = false) {
  const backend: MockBackend = createMockBackend({ latencyMs: 0 })
  const user = userEvent.setup()
  const tree = (
    <BackendContext.Provider value={backend}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/play/:scenario" element={<Play />} />
        </Routes>
      </MemoryRouter>
    </BackendContext.Provider>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  if (path.endsWith("shopping")) await screen.findByRole("switch", { name: "Retcon firewall" })
  return { user, backend }
}

const readPreset = async (user: User, label: string) => {
  await user.click(screen.getByRole("button", { name: label }))
  await user.click(screen.getByRole("button", { name: "Let the assistant read it" }))
}

const sendChat = async (user: User, text: string) => {
  await user.type(screen.getByLabelText(/message to the/i), text)
  await user.click(screen.getByRole("button", { name: "Send" }))
}

beforeEach(() => setViewport(true))
afterEach(() => vi.restoreAllMocks())

describe("playground flow (desktop)", () => {
  it("starts with Retcon on and updates the header when toggled", async () => {
    const { user } = await setup()
    const sw = screen.getByRole("switch", { name: "Retcon firewall" })
    expect(sw).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Retcon ON")).toBeInTheDocument()
    expect(screen.getByText("0 / 30")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument()

    await user.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"))
    expect(screen.getByText("Retcon OFF")).toBeInTheDocument()
    expect(screen.getByText("Firewall off")).toBeInTheDocument()
  })

  it("OFF: attack is stored, next refund is Hijacked, and rollback restores it", async () => {
    const { user, backend } = await setup()
    await user.click(screen.getByRole("switch", { name: "Retcon firewall" }))
    await waitFor(() => expect(screen.getByText("Retcon OFF")).toBeInTheDocument())

    await readPreset(user, "Obvious injection")
    expect(await screen.findByText("Stored")).toBeInTheDocument()
    expect(screen.getAllByText("tainted").length).toBeGreaterThan(0)
    expect(screen.getByText("1 / 30")).toBeInTheDocument()

    await sendChat(user, "Please refund my order #A100.")
    const log = screen.getByRole("log")
    expect(await within(log).findByText("Hijacked")).toBeInTheDocument()
    expect(within(log).getByText(/9988-1122-3344/, { selector: "p" })).toBeInTheDocument()

    // the newest event is the attacker's write
    await user.click(screen.getAllByRole("button", { name: /roll back to before this/i })[0])
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Changed")).toBeInTheDocument()
    expect(within(dialog).getByText(/Refunds go to the card ending 4242/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Confirm rollback" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    const rolls = backend.calls.filter((c) => c.name === "rollback")
    expect(rolls.map((c) => c.args[2])).toEqual([true, false])
    expect(backend.peek()!.memories.find((m) => m.key === "refund_method")!.text).toContain("4242")
  })

  it("ON: attack is quarantined, can be discarded and released", async () => {
    const { user, backend } = await setup()
    await readPreset(user, "Obvious injection")
    expect(await screen.findByText("Quarantined")).toBeInTheDocument()
    expect(screen.getAllByText(/attack_pattern/).length).toBeGreaterThan(0)

    await sendChat(user, "Please refund my order #A100.")
    const log = screen.getByRole("log")
    expect(await within(log).findByText("OK")).toBeInTheDocument()
    expect(within(log).queryByText("Hijacked")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /discard refund_method/i }))
    await waitFor(() => expect(screen.getByText("Discarded")).toBeInTheDocument())

    await readPreset(user, "Subtle instruction")
    await user.click(await screen.findByRole("button", { name: /release refund_method/i }))
    await waitFor(() => expect(screen.getAllByText("Released").length).toBeGreaterThan(0))
    expect(backend.peek()!.memories.find((m) => m.key === "refund_method")!.tainted).toBe(true)
  })

  it("shows a neutral external badge for a normal review and tainted only for an overwrite", async () => {
    const { user } = await setup()
    await readPreset(user, "Normal review")
    expect(await screen.findByText("Stored")).toBeInTheDocument()
    const memory = screen.getByRole("heading", { name: "Memory" }).closest("section")!
    expect(within(memory).getByText("external")).toBeInTheDocument()
    expect(within(memory).queryByText("tainted")).not.toBeInTheDocument()

    await user.click(screen.getByRole("switch", { name: "Retcon firewall" }))
    await waitFor(() => expect(screen.getByText("Retcon OFF")).toBeInTheDocument())
    await readPreset(user, "Obvious injection")
    expect(await within(memory).findByText("tainted")).toHaveAttribute("title", "An outside source changed your setting")
    expect(within(memory).getAllByText("external")).toHaveLength(1)
  })

  it("rollback preview under StrictMode sends one request and shows no error", async () => {
    const { user, backend } = await setup("/play/shopping", true)
    await user.click(screen.getByRole("switch", { name: "Retcon firewall" }))
    await waitFor(() => expect(screen.getByText("Retcon OFF")).toBeInTheDocument())
    await readPreset(user, "Obvious injection")
    await screen.findByText("Stored")
    await user.click(screen.getAllByRole("button", { name: /roll back to before this/i })[0])
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("Changed")).toBeInTheDocument()
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText(/still running/i)).not.toBeInTheDocument()
    expect(backend.calls.filter((c) => c.name === "rollback" && c.args[2] === true)).toHaveLength(1)
  })

  it("enforces the 2,000 character limit with a counter", async () => {
    const { user } = await setup()
    expect(screen.getByText("0 / 2,000")).toBeInTheDocument()
    const ta = screen.getByLabelText("Content to read")
    expect(ta).toHaveAttribute("maxlength", "2000")
    await user.click(ta)
    await user.paste("a".repeat(2500))
    expect(screen.getByText("2,000 / 2,000")).toBeInTheDocument()
  })

  it("renders untrusted text as text, not HTML", async () => {
    const { user } = await setup()
    await user.click(screen.getByLabelText("Content to read"))
    await user.paste("<img src=x onerror=alert(1)> nice product")
    await user.click(screen.getByRole("button", { name: "Let the assistant read it" }))
    expect((await screen.findAllByText(/<img src=x/)).length).toBeGreaterThan(0)
    expect(document.querySelector("img")).toBeNull()
  })
})

describe("errors", () => {
  const screens: [string, number, RegExp][] = [
    ["session_quota_exhausted", 429, /out of AI calls/],
    ["session_not_found", 404, /session has expired/],
    ["session_mismatch", 403, /not your session/],
  ]
  it.each(screens)("%s shows a screen with a restart button", async (code, status, title) => {
    const { user, backend } = await setup()
    backend.failNext(new ApiError(status, code, "x"), "chat")
    await sendChat(user, "hello")
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Start a new session" }))
    expect(await screen.findByRole("switch", { name: "Retcon firewall" })).toBeInTheDocument()
  })

  it("llm_unavailable keeps the draft and says nothing changed", async () => {
    const { user, backend } = await setup()
    backend.failNext(new ApiError(502, "llm_unavailable", "x"), "chat")
    await sendChat(user, "hello there")
    expect(await screen.findByRole("alert")).toHaveTextContent("This turn failed, try again. Nothing was changed.")
    expect(screen.getByLabelText(/message to the/i)).toHaveValue("hello there")
    expect(screen.getByText("0 / 30")).toBeInTheDocument()
  })

  it("session_busy shows a retry message", async () => {
    const { user, backend } = await setup()
    backend.failNext(new ApiError(409, "session_busy", "x", 2), "chat")
    await sendChat(user, "hi")
    expect(await screen.findByRole("alert")).toHaveTextContent(/still running.*2 seconds/)
  })

  const banners: [string, number, RegExp][] = [
    ["daily_quota_exhausted", 503, /budget for today/],
    ["db_unavailable", 503, /database/],
    ["network", 0, /offline/],
  ]
  it.each(banners)("%s shows a banner and keeps the page usable", async (code, status, text) => {
    const { user, backend } = await setup()
    backend.failNext(new ApiError(status, code, "x"), "chat")
    await sendChat(user, "hi")
    // the banner is the page-level alert; the inline notice is empty for these codes
    expect(await screen.findByRole("alert")).toHaveTextContent(text)
    expect(screen.getByRole("switch", { name: "Retcon firewall" })).toBeInTheDocument()
  })

  it("unknown scenario links back home", async () => {
    await setup("/play/nope")
    expect(await screen.findByRole("heading", { name: "Scenario not found" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/")
  })

  it("quota exhaustion after 30 calls ends the session", async () => {
    const { user, backend } = await setup()
    const sid = backend.peek()!.session_id
    for (let i = 0; i < 30; i++) await backend.chat(sid, "hi")
    await sendChat(user, "one more")
    expect(await screen.findByRole("heading", { name: /out of AI calls/ })).toBeInTheDocument()
  })
})

describe("mobile", () => {
  it("renders tabs instead of columns", async () => {
    setViewport(false)
    const { user } = await setup()
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Conversation", "Memory", "Activity"])
    expect(screen.getByLabelText(/message to the/i)).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Memory" }))
    expect(screen.getByText("refund_method")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Activity" }))
    expect(screen.getByText("Quarantine")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /roll back to before this/i }).length).toBeGreaterThan(0)
  })
})

describe("rollback dialog accessibility", () => {
  it("closes on Escape and returns focus to the opener", async () => {
    const { user } = await setup()
    const opener = screen.getAllByRole("button", { name: /roll back to before this/i })[0]
    await user.click(opener)
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAccessibleName("Roll back to before this change?")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})

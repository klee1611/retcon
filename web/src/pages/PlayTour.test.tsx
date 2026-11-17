import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BackendContext } from "@/lib/backend"
import { createMockBackend } from "@/mocks/mockBackend"
import { Play } from "@/pages/Play"

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

async function setup() {
  const backend = createMockBackend({ latencyMs: 0 })
  const user = userEvent.setup()
  render(
    <BackendContext.Provider value={backend}>
      <MemoryRouter initialEntries={["/play/shopping"]}>
        <Routes>
          <Route path="/play/:scenario" element={<Play />} />
        </Routes>
      </MemoryRouter>
    </BackendContext.Provider>,
  )
  await screen.findByRole("switch", { name: "Retcon firewall" })
  return { user }
}

const card = () => screen.queryByRole("dialog", { name: /Guided tour/ })
const sw = () => screen.getByRole("switch", { name: "Retcon firewall" })
const read = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Let the assistant read it" }))

beforeEach(() => {
  window.localStorage.clear()
  setViewport(true)
})
afterEach(() => window.localStorage.clear())

describe("guided tour", () => {
  it("offers the tour once and remembers a dismissal", async () => {
    const { user } = await setup()
    expect(card()).toBeNull()
    await user.click(screen.getByRole("button", { name: "No thanks" }))
    expect(screen.queryByRole("button", { name: "Take the 1-minute tour" })).toBeNull()
    expect(window.localStorage.getItem("retcon:tour-seen")).toBe("1")
  })

  it("does not show the prompt again once it has been seen", async () => {
    window.localStorage.setItem("retcon:tour-seen", "1")
    await setup()
    expect(screen.queryByRole("button", { name: "Take the 1-minute tour" })).toBeNull()
    expect(screen.getByRole("button", { name: "Tour" })).toBeInTheDocument()
  })

  it("still works when storage is unavailable", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    const { user } = await setup()
    await user.click(screen.getByRole("button", { name: "Take the 1-minute tour" }))
    expect(card()).toHaveTextContent("step 1 of 7")
    get.mockRestore()
    set.mockRestore()
  })

  it("advances from real state changes and pre-fills the example", async () => {
    const { user } = await setup()
    await user.click(screen.getByRole("button", { name: "Take the 1-minute tour" }))
    expect(card()).toHaveTextContent("step 1 of 7")
    expect(card()).toHaveFocus()
    expect(card()).toHaveAttribute("aria-modal", "false")

    await user.click(sw())
    await waitFor(() => expect(card()).toHaveTextContent("step 2 of 7"))
    expect((screen.getByLabelText("Content to read") as HTMLTextAreaElement).value).toMatch(/ignore previous instructions/i)
    expect(screen.getByLabelText("Content to read")).toHaveAttribute("data-tour-target", "ext-text")

    await read(user)
    await waitFor(() => expect(card()).toHaveTextContent("step 3 of 7"))

    await user.click(screen.getByRole("button", { name: "Please refund my order #A100." }))
    await waitFor(() => expect(card()).toHaveTextContent("step 4 of 7"))
    expect(within(screen.getByRole("region", { name: "Actions" })).getByText("Hijacked")).toBeInTheDocument()

    await user.click(screen.getAllByRole("button", { name: /Roll back to before this: Saved refund_method/ })[0])
    await user.click(await screen.findByRole("button", { name: "Confirm rollback" }))
    await waitFor(() => expect(card()).toHaveTextContent("step 5 of 7"))

    await user.click(sw())
    await waitFor(() => expect(card()).toHaveTextContent("step 6 of 7"))
    await read(user)
    await waitFor(() => expect(card()).toHaveTextContent("step 7 of 7"))
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Finish" }))
    expect(card()).toBeNull()
  })

  it("skips ahead when Retcon is already off, and Esc leaves the tour", async () => {
    const { user } = await setup()
    await user.click(sw())
    await waitFor(() => expect(sw()).toHaveAttribute("aria-checked", "false"))
    await user.click(screen.getByRole("button", { name: "Take the 1-minute tour" }))
    expect(card()).toHaveTextContent("step 2 of 7")
    await user.keyboard("{Escape}")
    expect(card()).toBeNull()
  })

  it("Skip tour closes it and the Tour button restarts it", async () => {
    const { user } = await setup()
    await user.click(screen.getByRole("button", { name: "Take the 1-minute tour" }))
    await user.click(screen.getByRole("button", { name: "Skip tour" }))
    expect(card()).toBeNull()
    await user.click(screen.getByRole("button", { name: "Tour" }))
    expect(card()).toHaveTextContent("step 1 of 7")
  })

  it("on mobile, shows the tab that holds the target", async () => {
    setViewport(false)
    const { user } = await setup()
    await user.click(screen.getByRole("button", { name: "Take the 1-minute tour" }))
    await user.click(sw())
    await waitFor(() => expect(card()).toHaveTextContent("step 2 of 7"))
    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true")
    await read(user)
    await waitFor(() => expect(card()).toHaveTextContent("step 3 of 7"))
    await user.click(screen.getByRole("button", { name: "Please refund my order #A100." }))
    await waitFor(() => expect(card()).toHaveTextContent("step 4 of 7"))
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true")
  })
})

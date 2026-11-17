import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  chat,
  createSession,
  discardQuarantine,
  getHealth,
  listScenarios,
  releaseQuarantine,
  rollback,
} from "@/lib/api"

function stub(res: { ok: boolean; status: number; body?: unknown; badJson?: boolean }) {
  const fn = vi.fn(() =>
    Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => (res.badJson ? Promise.reject(new Error("bad")) : Promise.resolve(res.body)),
    }),
  )
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe("api client success", () => {
  it("GET sends same-origin credentials", async () => {
    const f = stub({ ok: true, status: 200, body: { ok: true, db: "ok" } })
    expect((await getHealth()).ok).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/health")
    expect(init.credentials).toBe("same-origin")
  })

  it("listScenarios unwraps the scenarios array", async () => {
    stub({ ok: true, status: 200, body: { scenarios: [{ id: "shopping" }] } })
    expect(await listScenarios()).toHaveLength(1)
  })

  it("POST sends JSON content type and body", async () => {
    const f = stub({ ok: true, status: 201, body: { state: {} } })
    await createSession("shopping")
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/sessions")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
    expect(init.body).toBe(JSON.stringify({ scenario: "shopping" }))
  })

  it("builds session paths and bodies", async () => {
    const f = stub({ ok: true, status: 200, body: {} })
    await chat("sid1", "hi")
    await rollback("sid1", "h1", true)
    await releaseQuarantine("sid1", "q1")
    await discardQuarantine("sid1", "q1")
    const calls = f.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map((c) => c[0])).toEqual([
      "/api/sessions/sid1/chat",
      "/api/sessions/sid1/rollback",
      "/api/sessions/sid1/quarantine/q1/release",
      "/api/sessions/sid1/quarantine/q1/discard",
    ])
    expect(calls[1][1].body).toBe(JSON.stringify({ history_id: "h1", preview: true }))
  })
})

describe("api client errors", () => {
  it("parses the contract error format", async () => {
    stub({
      ok: false,
      status: 409,
      body: { error: { code: "session_busy", message: "Busy.", retry_after: 2 } },
    })
    const err = await chat("s", "x").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: "session_busy", message: "Busy.", retryAfter: 2 })
  })

  it("falls back to internal when the body is not the contract format", async () => {
    stub({ ok: false, status: 500, body: "oops" })
    await expect(chat("s", "x")).rejects.toMatchObject({ status: 500, code: "internal" })
    stub({ ok: false, status: 502, badJson: true })
    await expect(chat("s", "x")).rejects.toMatchObject({ status: 502, code: "internal" })
  })

  it("maps network failure to code network", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("failed"))))
    await expect(listScenarios()).rejects.toMatchObject({ code: "network", status: 0 })
  })
})

import { createContext, useContext } from "react"

import * as api from "@/lib/api"

/** The subset of the API client the playground uses. The mock implements the same shape. */
export type Backend = {
  listScenarios: typeof api.listScenarios
  createSession: typeof api.createSession
  getSession: typeof api.getSession
  chat: typeof api.chat
  ingest: typeof api.ingest
  toggle: typeof api.toggle
  rollback: typeof api.rollback
  releaseQuarantine: typeof api.releaseQuarantine
  discardQuarantine: typeof api.discardQuarantine
}

export const realBackend: Backend = {
  listScenarios: api.listScenarios,
  createSession: api.createSession,
  getSession: api.getSession,
  chat: api.chat,
  ingest: api.ingest,
  toggle: api.toggle,
  rollback: api.rollback,
  releaseQuarantine: api.releaseQuarantine,
  discardQuarantine: api.discardQuarantine,
}

let loaded: Promise<Backend> | null = null

/**
 * Real client by default. The mock is only reachable through a dynamic import behind a
 * build-time constant, so production builds without VITE_MOCK_API=1 do not ship it.
 */
export function loadBackend(): Promise<Backend> {
  if (!loaded) {
    if (import.meta.env.VITE_MOCK_API === "1") {
      loaded = import("@/mocks/mockBackend").then((m) => m.createMockBackend())
    } else {
      loaded = Promise.resolve(realBackend)
    }
  }
  return loaded
}

/** Tests (and storybook-style harnesses) can inject a backend. */
export const BackendContext = createContext<Backend | null>(null)
export const useBackendOverride = () => useContext(BackendContext)

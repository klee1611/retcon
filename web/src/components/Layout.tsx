import { NavLink, Outlet } from "react-router-dom"

import { ThemeToggle } from "@/components/ThemeToggle"
import { cn } from "@/lib/utils"

const links = [
  { to: "/play/shopping", label: "Play" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/eval", label: "Eval" },
]

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <NavLink to="/" className="font-semibold tracking-tight">
              Retcon
            </NavLink>
            <nav aria-label="Main" className="flex items-center gap-3 text-sm sm:gap-4">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    cn(
                      "whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                      isActive && "text-foreground",
                    )
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="container flex-1 py-10 sm:py-16">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="container flex h-14 items-center justify-between text-sm text-muted-foreground">
          <span>Retcon</span>
          <a
            href="https://github.com/klee1611/retcon"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}

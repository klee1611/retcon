import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { applyTheme, getInitialTheme, storeTheme, type Theme } from "@/lib/theme"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const next: Theme = theme === "dark" ? "light" : "dark"
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        storeTheme(next)
        setTheme(next)
      }}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  )
}

// Switches between light and dark. The choice goes on <html data-theme>,
// which styles.css reads, and into localStorage, which the inline script in
// index.html applies before first paint. With no choice, the system theme wins.

import { useState, type JSX } from "react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

function current(): Theme {
  const set = document.documentElement.dataset["theme"];
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState(current);
  const next: Theme = theme === "dark" ? "light" : "dark";

  const toggle = (): void => {
    document.documentElement.dataset["theme"] = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    setTheme(next);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="theme-toggle fixed top-3 right-4 rounded-full"
      aria-label={`Switch to ${next} theme`}
      onClick={toggle}
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </Button>
  );
}

// Switches between light and dark. The choice goes on <html data-theme>,
// which styles.css reads, and into localStorage, which the inline script in
// index.html applies before first paint. With no choice, the system theme wins.

import { createSignal, type JSX } from "solid-js";

type Theme = "light" | "dark";

function current(): Theme {
  const set = document.documentElement.dataset["theme"];
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = createSignal(current());
  const next = (): Theme => (theme() === "dark" ? "light" : "dark");

  const toggle = (): void => {
    const t = next();
    document.documentElement.dataset["theme"] = t;
    try {
      localStorage.setItem("theme", t);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    setTheme(t);
  };

  return (
    <button class="theme-toggle" type="button" aria-label={`Switch to ${next()} theme`} onClick={toggle}>
      {theme() === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

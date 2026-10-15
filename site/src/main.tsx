// Mounts the interactive parts into the static article in site/index.html.

import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { CopyButton } from "./CopyButton.tsx";
import { CpuChart, CpuTable } from "./CpuChart.tsx";
import { GcTimelineDiagram, LruDiagram, ReadStatesDiagram, RewriteDiagram } from "./Diagrams.tsx";
import { LiveChart } from "./LiveChart.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

function mount(id: string, view: JSX.Element): void {
  const el = document.querySelector(`#${id}`);
  if (el === null) throw new Error(`#${id} is missing from index.html`);
  createRoot(el).render(view);
}

mount("theme-toggle", <ThemeToggle />);
mount("read-states-diagram", <ReadStatesDiagram />);
mount("lru-diagram", <LruDiagram />);
mount("gc-diagram", <GcTimelineDiagram />);
mount("rewrite-diagram", <RewriteDiagram />);
mount("cpu-chart", <CpuChart />);
mount("cpu-table", <CpuTable />);
mount("live-chart", <LiveChart />);

for (const cmd of document.querySelectorAll(".cmd")) {
  const code = cmd.querySelector("code");
  if (code === null) continue;
  // A root of its own after the code, so React does not replace the tag and code.
  const slot = document.createElement("span");
  cmd.append(slot);
  createRoot(slot).render(<CopyButton text={code.textContent} fallback={code} />);
}

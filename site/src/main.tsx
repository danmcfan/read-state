// Mounts the interactive parts into the static article in site/index.html.

import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import { CopyButton } from "./CopyButton.tsx";
import { CpuChart, CpuTable } from "./CpuChart.tsx";
import { GcTimelineDiagram, LruDiagram, ReadStatesDiagram, RewriteDiagram } from "./Diagrams.tsx";
import { LiveChart } from "./LiveChart.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

function mount(id: string, view: () => JSX.Element): void {
  const el = document.querySelector(`#${id}`);
  if (el === null) throw new Error(`#${id} is missing from index.html`);
  render(view, el);
}

mount("theme-toggle", () => <ThemeToggle />);
mount("read-states-diagram", () => <ReadStatesDiagram />);
mount("lru-diagram", () => <LruDiagram />);
mount("gc-diagram", () => <GcTimelineDiagram />);
mount("rewrite-diagram", () => <RewriteDiagram />);
mount("cpu-chart", () => <CpuChart />);
mount("cpu-table", () => <CpuTable />);
mount("live-chart", () => <LiveChart />);

for (const cmd of document.querySelectorAll(".cmd")) {
  const code = cmd.querySelector("code");
  if (code !== null) render(() => <CopyButton text={code.textContent} fallback={code} />, cmd);
}

import { useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copies `text`; if the clipboard is blocked, selects `fallback` so the reader can copy it by hand. */
export function CopyButton(props: { text: string; fallback: Node }): JSX.Element {
  const [done, setDone] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setDone(true);
      setTimeout(() => {
        setDone(false);
      }, 1500);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(props.fallback);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  };

  return (
    <Button variant="outline" size="sm" className={cn("min-w-16", { "copy-done": done })} onClick={() => void copy()}>
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

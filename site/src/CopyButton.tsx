import { createSignal, type JSX } from "solid-js";

/** Copies `text`; if the clipboard is blocked, selects `fallback` so the reader can copy it by hand. */
export function CopyButton(props: { text: string; fallback: Node }): JSX.Element {
  const [done, setDone] = createSignal(false);

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
    <button class="copy" classList={{ done: done() }} type="button" onClick={() => void copy()}>
      {done() ? "Copied" : "Copy"}
    </button>
  );
}

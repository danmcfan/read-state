// `bun run verify diagrams`: the walkthrough's four diagrams render, and the
// LRU diagram steps through hits, inserts and an eviction, in both themes.

import { verify } from "../harness.ts";

const slots =
  "JSON.stringify([...document.querySelectorAll('#lru-diagram .lru-row .slot:not(.evicted)')].map((s) => s.textContent))";
const status = "document.querySelector('#lru-diagram .lru-status')?.textContent";
/** Runs `step` on each item in turn: browser actions must not overlap. */
async function inOrder<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  const [first, ...rest] = items;
  if (first === undefined) return;
  await step(first);
  await inOrder(rest, step);
}

const writeButton = "#lru-diagram .live-bar button:first-child";

await verify("diagrams", async (v) => {
  await v.open("/", "light");
  const svgs = await v.eval(
    "['read-states-diagram','gc-diagram','rewrite-diagram'].map((id) => document.querySelectorAll(`#${id} svg[role=img][aria-label]`).length).join()",
  );
  v.check(svgs === "1,1,1", "the three static diagrams render with labels", svgs);
  const spikes = await v.eval("document.querySelectorAll('#gc-diagram .gc-mark').length");
  v.check(spikes === 3, "the GC timeline marks three forced GCs", spikes);

  v.check((await v.eval(slots)) === '["","","","",""]', "the LRU cache starts empty", await v.eval(slots));
  await inOrder(["a", "b", "c"], async () => {
    await v.click(writeButton);
  });
  v.check((await v.eval(slots)) === '["c","b","a","",""]', "new keys go in front", await v.eval(slots));
  await v.click(writeButton);
  v.check((await v.eval(slots)) === '["a","c","b","",""]', "a hit moves the key to the front", await v.eval(slots));
  v.check(String(await v.eval(status)).includes("already cached"), "the status explains the hit", await v.eval(status));
  await inOrder(["d", "e", "b", "f"], async () => {
    await v.click(writeButton);
  });
  const evicted = await v.eval("document.querySelector('#lru-diagram .slot.evicted')?.textContent");
  v.check(evicted === "c", "a full cache evicts the least recently used key", evicted);
  v.check((await v.eval(slots)) === '["f","b","e","d","a"]', "the order after the eviction", await v.eval(slots));

  await inOrder(["read-states-diagram", "lru-diagram", "gc-diagram", "rewrite-diagram"], async (id) => {
    await v.screenshot(`${id}-light`, `#${id}`);
  });
  await v.open("/", "dark");
  await inOrder(["read-states-diagram", "gc-diagram", "rewrite-diagram"], async (id) => {
    await v.screenshot(`${id}-dark`, `#${id}`);
  });
  await v.assertNoErrors();
});

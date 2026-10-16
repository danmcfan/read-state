// `bun run verify btree`: "Run it yourself" explains why the live demo's Rust
// cache uses a `HashMap` when Discord swapped theirs for a `BTreeMap` (issue #38).

import { verify } from "../harness.ts";

const demo = "document.querySelector('#demo + p')?.textContent?.replace(/\\s+/gu, ' ')";

await verify("btree", async (v) => {
  await v.open();
  const text = await v.eval(demo);
  v.check(
    typeof text === "string" && text.includes("BTreeMap") && text.includes("garbage collection"),
    "the demo paragraph explains the HashMap and BTreeMap choice",
    text,
  );
  await v.screenshot("run-it-yourself", "#demo + p");
  await v.assertNoErrors();
});

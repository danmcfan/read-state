// `bun run verify fix-section`: "The fix" section says each point once: the
// rewrite diagram and its caption, with no Go/Rust comparison cards after it.

import { verify } from "../harness.ts";

await verify("fix-section", async (v) => {
  await v.open("/");
  const cards = await v.eval("document.querySelectorAll('.cards, .card').length");
  v.check(String(cards) === "0", "no comparison cards on the page", cards);
  const next = await v.eval(
    "document.querySelector('#rewrite-diagram')?.closest('figure')?.nextElementSibling?.tagName",
  );
  v.check(next === "P", "the rewrite diagram is followed by the outcome paragraph", next);
  await v.until("the rewrite diagram renders", "document.querySelector('#rewrite-diagram svg') !== null");
  await v.screenshot("fix-section", "#rewrite-diagram");
  await v.assertNoErrors();
});

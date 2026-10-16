// `bun run verify pointer-free`: the pointer-free layout has its own section
// after the live chart, with the forced-GC times drawn as bars (issue #33).

import { verify } from "../harness.ts";

await verify("pointer-free", async (v) => {
  await v.open();
  const intro = await v.eval(
    "[...document.querySelectorAll('#live ~ p')].find((p) => p.compareDocumentPosition(document.querySelector('#live-chart')) & 4)?.textContent ?? ''",
  );
  v.check(typeof intro === "string" && !/pointer/iu.test(intro), "the live intro no longer covers pointers", intro);
  v.check(
    (await v.eval(
      "!!(document.querySelector('#live-chart').compareDocumentPosition(document.querySelector('#pointer-free')) & 4)",
    )) === true,
    "the pointer-free section comes after the live chart",
  );
  await v.until("both GC bars render", "document.querySelectorAll('#gc-pause-bars .gc-pause').length === 2");
  const widths = await v.eval(
    "[...document.querySelectorAll('#gc-pause-bars rect')].map((r) => Number(r.getAttribute('width'))).join(',')",
  );
  v.check(widths === "440,2", "the pointer bar dwarfs the pointer-free one", widths);
  v.check(
    /flatters Go/u.test(
      String(await v.eval("document.querySelector('#gc-pause-bars').closest('figure').nextElementSibling.textContent")),
    ),
    "the flatters-Go caveat follows the bars",
  );
  await v.screenshot("bars", "#gc-pause-bars");
  await v.open("/", "dark");
  await v.screenshot("bars-dark", "#gc-pause-bars");
  await v.assertNoErrors();
});

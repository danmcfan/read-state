// `bun run verify results`: the fix section shows Discord's reported results
// as a table cited to the 2020 post (issue #36).

import { verify } from "../harness.ts";

const POST = "https://discord.com/blog/why-discord-is-switching-from-go-to-rust";

await verify("results", async (v) => {
  await v.open();
  const rows = await v.eval(
    "JSON.stringify([...document.querySelectorAll('#results tbody th')].map((th) => th.textContent?.trim()))",
  );
  v.check(
    rows === JSON.stringify(["Latency", "CPU", "Memory", "Cache capacity"]),
    "the table has the four metrics",
    rows,
  );
  const placed = await v.eval(
    "document.querySelector('#fix ~ #results') !== null && document.querySelector('#live ~ #results') === null",
  );
  v.check(placed === true, "the table sits in the fix section", placed);
  const cited = await v.eval(`document.querySelector('#results figcaption a')?.getAttribute('href')`);
  v.check(cited === POST, "the table cites Discord's post", cited);
  const capacity = await v.eval("document.querySelector('#results tbody')?.textContent?.includes('8 million')");
  v.check(capacity === true, "the table gives the 8 million capacity", capacity);
  await v.screenshot("results-light", "#results");
  await v.open("/", "dark");
  await v.screenshot("results-dark", "#results");
  await v.assertNoErrors();
});

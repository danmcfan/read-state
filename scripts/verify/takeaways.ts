// `bun run verify takeaways`: a Takeaways section closes the article, between
// the live demo and Run it yourself, as one heading and a short list (issue #35).

import { verify } from "../harness.ts";

await verify("takeaways", async (v) => {
  await v.open();
  v.check(
    (await v.eval("document.querySelector('#takeaways')?.nextElementSibling?.tagName")) === "UL",
    "the Takeaways heading is followed by a list",
  );
  v.check(
    (await v.eval("document.querySelector('#takeaways ~ ul')?.nextElementSibling?.id")) === "demo",
    "the list sits right before Run it yourself",
  );
  v.check(
    (await v.eval("document.querySelectorAll('#takeaways ~ ul > li').length")) === 3,
    "the list has three points",
  );
  v.check(
    (await v.eval(
      "document.querySelector('#takeaways')?.previousElementSibling?.querySelector('#live-chart') != null",
    )) === true,
    "the section follows the live demo",
  );
  await v.screenshot("takeaways", "#takeaways");
  await v.open("/#takeaways", "dark");
  await v.screenshot("takeaways-dark", "#takeaways");
  await v.assertNoErrors();
});

// `bun run verify takeaways`: a Takeaways section closes the article, between
// the live demo and Run it yourself, as one heading and a short list (issue #35).

import { verify } from "../harness.ts";

await verify("takeaways", async (v) => {
  await v.open();
  const afterHeading = await v.eval("document.querySelector('#takeaways')?.nextElementSibling?.tagName");
  v.check(afterHeading === "UL", "the Takeaways heading is followed by a list", afterHeading);
  const afterList = await v.eval("document.querySelector('#takeaways ~ ul')?.nextElementSibling?.id");
  v.check(afterList === "demo", "the list sits right before Run it yourself", afterList);
  const points = await v.eval("document.querySelectorAll('#takeaways ~ ul > li').length");
  v.check(points === 3, "the list has three points", points);
  const followsDemo = await v.eval(
    "document.querySelector('#takeaways')?.previousElementSibling?.querySelector('#live-chart') != null",
  );
  v.check(followsDemo === true, "the section follows the live demo", followsDemo);
  await v.screenshot("takeaways", "#takeaways");
  await v.open("/#takeaways", "dark");
  await v.screenshot("takeaways-dark", "#takeaways");
  await v.assertNoErrors();
});

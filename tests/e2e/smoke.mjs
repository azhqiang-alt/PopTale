// Smoke test in WebKit (the engine of iPhone Safari and WeChat on iOS): the shelf loads, a
// book opens, the narrator lights words up, a page turns, and nothing throws.
//   npm run test:e2e        (builds, serves dist/ and runs on an iPhone 13 and an iPhone SE)
// Needs the browser once: npx playwright install webkit
import { webkit, devices } from "playwright";
import { spawn } from "node:child_process";

const PORT = 4179;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("preview server did not start");
}

async function run(browser, name, ua = "") {
  const dev = devices[name];
  const ctx = await browser.newContext({ ...dev, userAgent: dev.userAgent + ua });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push(`${r.url()} ${r.failure()?.errorText}`));
  const label = `${name}${ua ? " (WeChat)" : ""}`;
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.body.dataset.view === "shelf", null, { timeout: 20000 });
  check(await page.evaluate(() => document.fonts.check('24px "LXGW WenKai"', "乐乐")), `${label}: web font loaded`);
  // tap the first book: its spot depends on the screen, so try a few
  const { width, height } = page.viewportSize();
  let picked = false;
  for (const [x, y] of [[width * 0.37, height * 0.22], [width * 0.3, height * 0.4], [width * 0.18, height * 0.5]]) {
    await page.touchscreen.tap(x, y);
    picked = await page.waitForSelector("#btn-open", { state: "visible", timeout: 4000 }).then(() => true, () => false);
    if (picked) break;
  }
  check(picked, `${label}: a book can be picked`);
  if (picked) {
    await page.tap("#btn-open");
    await page.waitForFunction(() => document.body.dataset.view === "book", null, { timeout: 15000 });
    const lit = await page.waitForFunction(() => document.querySelector("#page-words .word.active"), null, { timeout: 15000 }).then(() => true, () => false);
    check(lit, `${label}: narration lights up words`);
    const fits = await page.evaluate(() => [...document.querySelectorAll("#reader-bar > *")].every((e) => e.getBoundingClientRect().right <= innerWidth));
    check(fits, `${label}: top bar fits the screen`);
    await page.tap("#btn-next");
    const turned = await page.waitForFunction(() => document.querySelector("#page-eyebrow").textContent.replace(/\s/g, "").startsWith("第2页"), null, { timeout: 10000 }).then(() => true, () => false);
    check(turned, `${label}: the page turns`);
  }
  check(errors.length === 0, `${label}: no errors${errors.length ? ": " + errors.join("; ") : ""}`);
  await ctx.close();
}

try {
  await waitForServer();
  const browser = await webkit.launch();
  await run(browser, "iPhone 13");
  await run(browser, "iPhone 13", " MicroMessenger/8.0.50(0x1800323c) NetType/WIFI Language/zh_CN");
  await run(browser, "iPhone SE");
  await browser.close();
} finally {
  server.kill();
}
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }

/** Replay one WAV per sample-show actor line through Edge's real capture path. */
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const files = process.argv.slice(2);
if (!files.length)
  throw Error(
    "Pass actor WAV paths in cue order, with at least 1 second of trailing silence.",
  );
const port = Number(process.env.CUE_BENCH_PORT || 8765);
const results = [];
for (const [index, file] of files.entries()) {
  const browser = await chromium.launch({
    channel: process.env.CUE_BROWSER || "msedge",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-file-for-fake-audio-capture=" + resolve(file) + "%noloop",
    ],
  });
  try {
    const page = await browser.newPage();
    if (port !== 8765)
      await page.addInitScript((port) => {
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket {
          constructor(url, ...args) {
            super(
              String(url).replace("127.0.0.1:8765", "127.0.0.1:" + port),
              ...args,
            );
          }
        };
      }, port);
    await page.goto("http://127.0.0.1:5173/");
    await page
      .getByTitle("Jump to cue-" + (index + 1), { exact: true })
      .click();
    await page.getByRole("button", { name: "Match diagnostics" }).click();
    await page
      .getByRole("button", { name: "Start rehearsal", exact: true })
      .click();
    const diagnostics = page.locator(".diagnostics");
    const fired = await diagnostics
      .getByText(/p50 \d+ ms/)
      .waitFor({ timeout: 12000 })
      .then(
        () => true,
        () => false,
      );
    const log = await diagnostics.innerText();
    const row = {
      cue: index + 1,
      fired,
      ms: fired ? Number(log.match(/p50 (\d+) ms/)[1]) : null,
      log,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  } finally {
    await browser.close();
  }
}
const measured = results
  .filter((r) => r.fired)
  .map((r) => r.ms)
  .sort((a, b) => a - b);
console.log({
  cues: results.length,
  fired: measured.length,
  p50: measured[Math.ceil(measured.length * 0.5) - 1],
  p95: measured[Math.ceil(measured.length * 0.95) - 1],
});

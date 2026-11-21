// Run against a QA WebView2 instance with an isolated profile and CDP on 21879.
import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import assert from "node:assert/strict";
function sceneZip() {
  const image = (color) => Buffer.from(color, "base64");
  const a = "game/resources/sprites/sub/blue.png",
    b = "game/resources/sprites/sub/amber.png",
    alias = "game/resources/sprites/sub/cue.png";
  const entry = "game/scripts/opening.smx";
  const files = {
    [entry]: strToU8(
      'UI.Load "lights"\nnetwork.on ("light_change", msg) = do\n UI.lights.stage.panel.image = "sprites/sub/cue.png"\nend do',
    ),
    "game/scripts/lights.smui": strToU8(
      JSON.stringify({
        name: "lights",
        canvasWidth: 900,
        canvasHeight: 600,
        layers: [
          {
            name: "stage",
            widgets: [
              {
                name: "panel",
                type: "IMAGE",
                width: 900,
                height: 600,
                widthMode: "FIXED",
                heightMode: "FIXED",
                imagePath: "sprites/sub/blue.png",
                imageScaleMode: "stretch",
              },
            ],
          },
        ],
      }),
    ),
    [a]: image(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGMUdS9lwAaYsIoOWgkAqE4A4fzX3BkAAAAASUVORK5CYII=",
    ),
    [b]: image(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP8v1iEARtgwio6aCUAWsYBxhzxFowAAAAASUVORK5CYII=",
    ),
  };
  return Buffer.from(
    zipSync({
      ...files,
      "game-manifest.json": strToU8(
        JSON.stringify({
          entry,
          files: [...Object.keys(files), alias],
          aliases: { [alias]: b },
        }),
      ),
    }),
  );
}
const b = await chromium.connectOverCDP("http://127.0.0.1:21879");
const p = b.contexts()[0].pages()[0];
p.setDefaultTimeout(12000);
p.on("pageerror", (e) => console.log("error", String(e)));
p.on("console", (m) => {
  if (/error|invalid|load failed/i.test(m.text()))
    console.log(m.text().slice(0, 220));
});
try {
  await p.goto("http://127.0.0.1:21870/#editor");
  let base = await (
    await p.request.get("http://127.0.0.1:21870/example-show.json")
  ).json();
  base.showId = "installation-scene-check";
  base.title = "Scene import verification";
  base.states[0].actions = [
    { type: "scenemax", event: "light_change", message: "gold" },
  ];
  base.sceneMax = {
    gateway: "ws://127.0.0.1:21872",
    projectGuid: "external-test",
    scene: "main",
    sessionId: 1000,
  };
  await p.evaluate((show) => {
    localStorage.setItem("stagecue.projects", JSON.stringify([show]));
    localStorage.setItem("stagecue.selected", show.showId);
  }, base);
  await p.reload();
  await p
    .locator("summary")
    .filter({ hasText: "SceneMax attachment for this script" })
    .click();
  await p.locator('input[accept=".zip"]').setInputFiles({
    name: "independent-scene.zip",
    mimeType: "application/zip",
    buffer: sceneZip(),
  });
  await p
    .getByText("Scene attached. Save the script to use it in rehearsal.")
    .waitFor();
  await p.getByRole("button", { name: "Save scene" }).click();
  await p.reload();
  await p.getByRole("link", { name: "Rehearsal", exact: true }).click();
  await p.getByLabel("Input source").selectOption("mock");
  const start = p.getByRole("button", { name: "Start rehearsal", exact: true });
  await start.waitFor({ timeout: 40000 });
  const canvas = p.frameLocator(".scenemax-frame").locator("canvas");
  async function pixel() {
    const data = (await canvas.screenshot()).toString("base64");
    return p.evaluate(async (data) => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d");
      ctx.drawImage(
        img,
        Math.floor(img.width / 2),
        Math.floor(img.height / 2),
        1,
        1,
        0,
        0,
        1,
        1,
      );
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }, data);
  }
  async function checkColor(expected) {
    for (let i = 0; i < 20; i++) {
      if (JSON.stringify(await pixel()) === JSON.stringify(expected)) return;
      await p.waitForTimeout(150);
    }
    assert.deepEqual(await pixel(), expected);
  }
  await checkColor([21, 71, 117]);
  await start.click();
  await p.getByRole("button", { name: "Manually fire current cue" }).click();
  await checkColor([255, 163, 20]);
  console.log("Studio counter:", await p.locator(".counter").innerText());
} catch (e) {
  console.log(p.frames().map((f) => f.url()));
  for (const f of p.frames().slice(1))
    console.log("iframe:", await f.locator("body").innerText());
  throw e;
} finally {
  await b.close();
}

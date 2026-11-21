import { test, expect } from "@playwright/test";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";

test("the language changes immediately, persists, and keeps the cue sheet on the right", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "General settings" }).click();
  for (const [lang, heading] of [
    ["de", "Probenstudio"],
    ["es", "Estudio de ensayo"],
    ["he", "אולפן חזרות"],
  ]) {
    await page.locator("dialog select").selectOption(lang);
    await expect(page.locator("h1")).toHaveText(heading);
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  for (const width of [1200, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page
        .locator(".upper")
        .evaluate(
          (el) =>
            el.children[0].getBoundingClientRect().right <=
            el.children[1].getBoundingClientRect().left,
        ),
    ).toBe(true);
  }
});
test("a student imports an attached scene and all media into an independent workspace", async ({
  page,
  browser,
}) => {
  await page.goto("/#editor");
  const scene = zipSync({
    "scripts/main.smx": strToU8("wait 1 second"),
    "resources/music/nested.bin": new Uint8Array([1, 2, 3]),
  });
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles({
      name: "lesson.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(scene),
    });
  await expect(page.getByRole("status")).toContainText("Scene attached");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Scene File" }).click();
  const exported = await pending;
  expect(exported.suggestedFilename()).toMatch(/\.srs$/);
  const bytes = await readFile((await exported.path())!);
  const archive = unzipSync(bytes);
  expect(Array.from(archive["scene/game/resources/music/nested.bin"])).toEqual([
    1, 2, 3,
  ]);
  const ctx = await browser.newContext();
  try {
    const student = await ctx.newPage();
    await student.goto("http://127.0.0.1:5173");
    const input = student.locator('input[accept=".srs"]');
    const upload = (buffer: Buffer) =>
      input.setInputFiles({
        name: "lesson.srs",
        mimeType: "application/zip",
        buffer,
      });
    const invalid = { ...archive };
    delete invalid["assets/ari-1.wav"];
    await upload(Buffer.from(zipSync(invalid)));
    await expect(student.getByRole("alert")).toContainText("Missing file");
    await upload(bytes);
    await expect(student.locator(".scenemax-frame")).toHaveCount(1);
    await student.goto("http://127.0.0.1:5173/#editor");
    await student.reload();
    await expect(student.getByLabel("Script title")).toHaveValue(
      "Before the curtain",
    );
    await student.route("**/assets/*.wav", (r) => r.abort());
    const next = student.waitForEvent("download");
    await student.getByRole("button", { name: "Export Scene File" }).click();
    const again = unzipSync(await readFile((await (await next).path())!));
    for (const path of Object.keys(archive).filter(
      (k) => k.startsWith("assets/") || k.startsWith("scene/"),
    ))
      expect(
        Buffer.compare(Buffer.from(archive[path]), Buffer.from(again[path])),
      ).toBe(0);
  } finally {
    await ctx.close();
  }
});

test("a multi-script scene preserves its active script and per-script SceneMax attachment", async ({
  page,
  browser,
}) => {
  await page.goto("/#editor");
  await page.getByRole("button", { name: "New scene", exact: true }).click();
  await page.getByLabel("Scene title").fill("Duet");
  await page.getByLabel("Script title").fill("First role");
  const pack = zipSync({ "scripts/main.smx": strToU8("wait 1 second") });
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles({
      name: "lights.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(pack),
    });
  await expect(page.getByRole("status")).toContainText("Scene attached");
  await page.getByRole("button", { name: "Add script", exact: true }).click();
  await page.getByLabel("Script title").fill("Second role");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Scene File" }).click();
  const exported = await pending;
  expect(exported.suggestedFilename()).toBe("Duet.srs");
  const bytes = await readFile((await exported.path())!);
  const contents = unzipSync(bytes);
  expect(
    JSON.parse(Buffer.from(contents["stagecue.json"]).toString()),
  ).toMatchObject({ version: 2, scriptCount: 2, title: "Duet", active: 1 });
  expect(contents["scripts/0/scene/game-manifest.json"]).toBeDefined();
  expect(contents["scripts/1/scene/game-manifest.json"]).toBeUndefined();
  const student = await browser.newContext();
  try {
    const p = await student.newPage();
    await p.goto("http://127.0.0.1:5173/#editor");
    await p
      .locator('input[accept=".srs"]')
      .setInputFiles({
        name: "Duet.srs",
        mimeType: "application/zip",
        buffer: bytes,
      });
    await expect(p.getByLabel("Script title")).toHaveValue("Second role");
    await expect(p.getByLabel("Scene title")).toHaveValue("Duet");
    await p
      .getByLabel("Scripts in scene")
      .selectOption({ label: "First role" });
    await expect(p.getByLabel("Script title")).toHaveValue("First role");
    await p.getByRole("link", { name: "Rehearsal", exact: true }).click();
    await expect(p.locator(".scenemax-frame")).toHaveCount(1);
    await p.getByLabel("Active script").selectOption({ label: "Second role" });
    await expect(p.locator(".scenemax-frame")).toHaveCount(0);
  } finally {
    await student.close();
  }
});

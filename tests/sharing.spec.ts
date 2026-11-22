import { test, expect } from "@playwright/test";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";

test("the language changes immediately, persists, and keeps the cue sheet on the right", async ({
  page,
}) => {
  await page.goto("/#player");
  await page.getByRole("button", { name: "General settings" }).click();
  for (const [lang, heading] of [
    ["de", "Probenstudio"],
    ["es", "Estudio de ensayo"],
    ["he", "אולפן חזרות"],
  ]) {
    await page.locator('dialog select:has(option[value="he"])').selectOption(lang);
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

test("a remote author can package the wizard example with text-only Hebrew speech", async ({ page }) => {
  const instructions = await readFile("src/create-scene-prompt.txt", "utf8");
  const entries = Object.fromEntries(["stagecue.json", "show.json"].map(name => {
    const line = instructions.split(/\r?\n/).find(s => s.startsWith(name + ": "))!;
    return [name, strToU8(line.slice(name.length + 2))];
  }));
  const wav = await readFile("public/assets/ari-1.wav");
  let request;
  await page.route("**/api/speech", async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ contentType: "audio/wav", body: wav });
  });
  await page.goto("/");
  await page.locator('input[accept=".srs"]').setInputFiles({
    name: "lesson.srs", mimeType: "application/zip", buffer: Buffer.from(zipSync(entries)),
  });
  await expect(page.getByLabel("Active scene").locator("option:checked")).toHaveText("Lesson");
  await page.getByLabel("Input source").selectOption("mock");
  await page.locator(".transport").getByRole("button", { name: "Start rehearsal", exact: true }).click();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect.poll(() => request).toEqual({ voice: "noa", text: "שלום לך" });
  await expect(page.locator(".phase")).toHaveText("Scene complete", { timeout: 15000 });
});

test("settings route a test sound to the selected output and remember it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      value: async () => [{ kind: "audiooutput", deviceId: "headphones", label: "Headphones" }],
    });
    Object.defineProperty(navigator.mediaDevices, "setPreferredSinkId", {
      value: async (id: string) => { document.documentElement.dataset.testSink = id; },
    });
  });
  await page.goto("/");
  const open = page.getByRole("button", { name: "General settings" });
  const output = page.getByRole("combobox", { name: "Audio output" });
  await open.click();
  await output.selectOption("headphones");
  await expect(page.locator("html")).toHaveAttribute("data-test-sink", "headphones");
  await page.getByRole("button", { name: "Test sound" }).click();
  await expect(page.getByText("Test sound finished.")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-test-sink", "headphones");
  await open.click();
  await expect(output).toHaveValue("headphones");
  await output.selectOption("");
  await expect(page.locator("html")).toHaveAttribute("data-test-sink", "");
});

test("removed scenes can be restored and permanent deletion releases only their local assets", async ({page}) => {
  await page.goto("/");
  const base = await (await page.request.get("/example-show.json")).json();
  await page.evaluate(async base => {
    const scenes = ["A1", "A2", "B"].map(id => ({
      ...base, showId:id, collection:{id:id[0], title:"Lesson "+id[0]},
      sceneMax:{projectGuid:"example", sessionId:1000, scene:"main"},
      scenePackage:{id:(id === "A1" ? "a" : "b").repeat(64), name:"Example"},
    }));
    localStorage.setItem("stagecue.projects", JSON.stringify(scenes));
    for (const [name, store, keys] of [
      ["stagecue-media", "files", ["A1/image.png","A2/old.wav","B/audio.wav"]],
      ["stagecue.scenes", "packages", ["a".repeat(64),"b".repeat(64)]],
    ] as const) {
      await new Promise<void>((resolve,reject) => {
        const req = indexedDB.open(name,1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onsuccess = () => {
          const tx = req.result.transaction(store,"readwrite");
          for(const key of keys) tx.objectStore(store).put(new Blob(["example"]),key);
          tx.oncomplete = () => {req.result.close();resolve();};
          tx.onabort = () => reject(tx.error);
        };
      });
    }
  },base);
  await page.reload();
  const manage = page.getByRole("button",{name:"Manage scene · Lesson A", exact:true});
  await manage.click();
  await page.getByRole("button",{name:"Remove from library"}).click();
  await page.reload();
  await expect(manage).toHaveCount(0);
  await page.locator(".removed-scenes summary").click();
  await page.locator(".removed-scenes").getByRole("button",{name:"Lesson A"}).click();
  await page.getByRole("button",{name:"Restore to library"}).click();
  await manage.click();
  await page.getByRole("button",{name:"Delete from this computer…"}).click();
  await page.getByRole("button",{name:"Cancel"}).click();
  await manage.click();
  await page.getByRole("button",{name:"Delete from this computer…"}).click();
  await page.getByRole("button",{name:"Delete permanently"}).click();
  await expect(manage).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".removed-scenes")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Manage scene · Lesson B"})).toBeVisible();
  const keys = await page.evaluate(async () => Promise.all(
    [["stagecue-media","files"],["stagecue.scenes","packages"]].map(([name,store]) =>
      new Promise<IDBValidKey[]>(resolve => {
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const read = req.result.transaction(store).objectStore(store).getAllKeys();
          read.onsuccess = () => {req.result.close();resolve(read.result);};
        };
      }))
  ));
  expect(keys).toEqual([["B/audio.wav"],["b".repeat(64)]]);
});

test("scene cards keep creation time and record a fresh local time on import", async ({page}) => {
  const created = "2026-04-15T09:10:00.000Z", imported = "2026-04-16T12:30:00.000Z";
  await page.clock.setFixedTime(new Date(created));
  await page.goto("/#editor");
  await page.getByRole("button",{name:"New scene",exact:true}).click();
  await page.getByRole("button",{name:"Add script",exact:true}).click();
  await page.getByRole("button",{name:"Save scene",exact:true}).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button",{name:"Export Scene File"}).click();
  const archive = await (await pending).path();
  await page.goto("/");
  const cardDate = page.locator(".library-date");
  await expect(cardDate.filter({hasText:"Created"}).locator("time")).toHaveAttribute("datetime",created);
  await expect(cardDate.filter({hasText:"Date added unavailable"}).first()).toBeVisible();
  await page.clock.setFixedTime(new Date(imported));
  await page.locator('input[accept=".srs"]').setInputFiles(archive!);
  await expect(page.getByLabel("Active script").locator("option")).toHaveCount(2);
  await page.goto("/");
  await page.reload();
  await expect(cardDate.filter({hasText:"Imported"}).locator("time")).toHaveAttribute("datetime",imported);
  await expect(cardDate.filter({hasText:"Created"}).locator("time")).toHaveAttribute("datetime",created);
});

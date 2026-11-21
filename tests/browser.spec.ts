import { test, expect } from "@playwright/test";
test("runs the five prerecorded cues and supports transport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Input source").selectOption("mock");
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Simulate", exact: true }).click();
    if (i === 0) {
      await page.getByRole("button", { name: "Pause rehearsal" }).click();
      await expect(page.locator(".phase")).toHaveText("Paused");
      await page.getByRole("button", { name: "Resume", exact: true }).click();
    }
    await expect(page.locator(".phase")).toHaveText(
      i === 4 ? "Scene complete" : "Listening",
      { timeout: 10000 },
    );
  }
  await expect(
    page.locator(".entry").filter({ hasText: "Cue fired" }),
  ).toHaveCount(5);
  expect(errors).toEqual([]);
});
test("editor saves, reloads, exports and imports a show", async ({ page }) => {
  await page.goto("/#editor");
  await page.getByRole("button", { name: "Duplicate script" }).click();
  await expect(page.getByLabel("Script title")).toHaveValue(
    "Before the curtain (copy)",
  );
  await page.getByLabel("Script title").fill("Class scene");
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await expect(page.getByLabel("Script title")).toHaveValue("Class scene");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Scene File" }).click();
  const path = await (await download).path();
  await page.locator('input[type=file][accept=".srs"]').setInputFiles(path!);
  await expect(
    page.getByLabel("Scripts in scene").locator("option"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Active scene").locator("option")).toHaveCount(
    4,
  );
});
test("microphone denial is visible and recoverable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException(
          "Microphone permission denied",
          "NotAllowedError",
        );
      },
    });
  });
  await page.routeWebSocket("ws://127.0.0.1:8765", (ws) =>
    ws.onMessage(() => ws.send('{"type":"ready"}')),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("denied");
  await expect(page.getByLabel("Input source")).toBeEnabled();
});

test("reconnects imported audio and retains playback across reload", async ({
  page,
}) => {
  const example = await (await page.request.get("/example-show.json")).json();
  const audio = await (await page.request.get("/assets/ari-1.wav")).body();
  example.showId = "import-check";
  example.assets[0].uri = "assets/my-recording.wav";
  await page.goto("/#editor");
  await page.evaluate((show) => {
    localStorage.setItem("stagecue.projects", JSON.stringify([show]));
    localStorage.setItem("stagecue.selected", show.showId);
  }, example);
  await page.reload();
  await expect(
    page.getByText(/Reconnect missing media in the library/),
  ).toBeVisible();
  await page
    .locator('input[type="file"][multiple][accept^="audio/"]')
    .setInputFiles({
      name: "my-recording.wav",
      mimeType: "audio/wav",
      buffer: audio,
    });
  await expect(
    page.getByText(/Reconnect missing media in the library/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Test cue", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Cue test complete", {
    timeout: 8000,
  });
});

test("reports a disconnected ASR service and permits retry", async ({
  page,
}) => {
  let connections = 0;
  await page.routeWebSocket("ws://127.0.0.1:8765", (ws) => {
    connections++;
    ws.close();
  });
  await page.goto("/");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Start rehearsal", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("offline");
  }
  expect(connections).toBe(2);
});

test("jump, replay and emergency stop cancel pending progression", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Input source").selectOption("mock");
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  await page.getByRole("button", { name: "Manually fire current cue" }).click();
  await page.getByTitle("Jump to cue-4", { exact: true }).click();
  await page.getByRole("button", { name: "Replay last cue" }).click();
  await expect(page.locator(".phase")).toHaveText("Playing cue");
  await page
    .getByRole("button", { name: "Stop rehearsal", exact: true })
    .click();
  await expect(page.locator(".phase")).toHaveText("Ready");
  await expect(page.locator(".counter")).toHaveText("01 / 05");
});

test("cue sheet follows automatic progress inside its own scroll container", async ({
  page,
}) => {
  await page.goto("/?show=gaon-iris-gaon");
  await page.getByLabel("Input source").selectOption("mock");
  const visible = () =>
    page.locator(".sheetlist").evaluate((el) => {
      const rows = Array.from(el.children);
      const index = rows.findIndex((row) => row.classList.contains("current"));
      const box = el.getBoundingClientRect();
      return (
        index >= 0 &&
        rows.slice(index, index + 3).every((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
        })
      );
    });
  await page.getByTitle("Jump to turn-25", { exact: true }).click();
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  await page.locator(".sheetlist").evaluate((el) => (el.scrollTop = 0));
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.locator(".counter")).toHaveText("26 / 29");
  await expect.poll(visible).toBe(true);
  await expect(page.locator(".counter")).toHaveText("27 / 29", {
    timeout: 15000,
  });
  await expect.poll(visible).toBe(true);
  for (const cue of ["turn-28", "turn-29", "turn-05"]) {
    await page.getByTitle("Jump to " + cue, { exact: true }).click();
    await expect.poll(visible).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(visible).toBe(true);
});

test("editor saves parallel YouTube, image and SceneMax actions and player dispatches the event", async ({
  page,
}) => {
  const packets: Buffer[] = [];
  await page.routeWebSocket("ws://127.0.0.1:21972", (ws) =>
    ws.onMessage((raw) => {
      const packet = Buffer.from(raw);
      packets.push(packet);
      if (packet[5] === 1) {
        const accept = Buffer.alloc(78);
        packet.copy(accept, 0, 0, 8);
        accept[5] = 2;
        accept.writeUInt16LE(7, 8);
        accept.writeUInt32LE(1000, 10);
        ws.send(accept);
        const ready = Buffer.from(packet.subarray(0, 8));
        ready[5] = 32;
        ws.send(ready);
      }
    }),
  );
  await page.route("https://www.youtube.com/embed/**", (r) =>
    r.fulfill({ body: "<html>Clip player</html>", contentType: "text/html" }),
  );
  await page.goto("/#editor");
  const base = await (await page.request.get("/example-show.json")).json();
  base.showId = "parallel-test";
  base.title = "Parallel test";
  base.assets.push({ id: "photo", type: "image", uri: "assets/stage.webp" });
  await page.evaluate((show) => {
    localStorage.setItem("stagecue.projects", JSON.stringify([show]));
    localStorage.setItem("stagecue.selected", show.showId);
  }, base);
  await page.reload();
  await page.getByLabel("Action timing").selectOption("parallel");
  const add = page.getByRole("button", { name: "Add action", exact: true });
  const remove = page.getByRole("button", { name: "Delete action" });
  const count = await remove.count();
  await page.getByLabel("Action type").selectOption("wait");
  await expect(remove).toHaveCount(count);
  await add.click();
  await add.click();
  await expect(remove).toHaveCount(count + 2);
  await remove.last().click();
  await remove.last().click();
  await expect(remove).toHaveCount(count);
  await page.getByLabel("Action type").selectOption("show_image");
  await add.click();
  await page.getByLabel("Media file").last().selectOption("photo");
  await page.getByLabel("Action type").selectOption("youtube");
  await add.click();
  await page
    .getByLabel("YouTube link")
    .fill("https://youtu.be/M7lc1UVf-VE?t=4");
  await page.getByLabel("Action type").selectOption("scenemax");
  await add.click();
  await page.locator(".scene-settings summary").click();
  await page.getByLabel("Project GUID").fill("stagecue-test");
  await page.getByLabel("WebSocket gateway").fill("ws://127.0.0.1:21972");
  await page.getByLabel("Event name").fill("animation_cue");
  await page.getByLabel("Message", { exact: true }).fill("lights");
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.getByRole("link", { name: "Rehearsal", exact: true }).click();
  await page.getByLabel("Input source").selectOption("mock");
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.locator(".stage iframe")).toHaveAttribute(
    "src",
    /M7lc1UVf-VE.*start=4/,
  );
  await expect(page.locator(".stage img")).toBeVisible();
  await expect(page.locator(".phase")).toHaveText("Playing cue");
  await expect.poll(() => packets.filter((b) => b[5] === 24).length).toBe(1);
  const event = packets.find((b) => b[5] === 24)!;
  expect(event.readUInt16LE(6)).toBe(7);
  expect(event.subarray(10).toString()).toBe("animation_cue\0lights");
  await page
    .getByRole("button", { name: "Stop rehearsal", exact: true })
    .click();
  await expect(page.locator(".stage iframe")).toHaveCount(0);
});

test("optional words survive editing and the actor can review word matches after advancing", async ({
  page,
}) => {
  await page.goto("/#editor");
  const line = page.getByRole("textbox", { name: "Script line", exact: true });
  await line.fill("אנחנו חייבים לעשות עם זה משהו עכשיו");
  await line.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf("לעשות");
    el.setSelectionRange(start, start + "לעשות עם זה".length);
  });
  await page.getByRole("button", { name: "Mark selection optional" }).click();
  await expect(line).toHaveValue("אנחנו חייבים #לעשות עם זה# משהו עכשיו");
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.getByRole("link", { name: "Rehearsal", exact: true }).click();
  await page.getByLabel("Input source").selectOption("mock");
  await page
    .getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  const spoken = page.getByLabel("Simulated Hebrew utterance");
  await spoken.fill("אנחנו משהו");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.locator(".line .match-unheard")).toHaveText("חייבים");
  await expect(page.locator(".line .match-optional")).toHaveText("לעשות עם זה");
  await spoken.fill("אנחנו חייבים משהו עכשיו");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.locator(".counter")).toHaveText("02 / 05", {
    timeout: 12000,
  });
  await expect(page.locator(".word-feedback p .match-heard")).toHaveCount(4);
});

test("scene connection changes reach sibling scripts and action delete icons stay physically right", async ({
  page,
}) => {
  await page.goto("/?show=gaon-iris-gaon-elevator#editor");
  const settings = page.locator(".scene-settings");
  await settings.locator("summary").click();
  await settings.getByLabel("Project GUID").fill("shared-stage-room");
  await page.getByRole("button", { name: "Save scene" }).click();
  const scripts = page.getByLabel("Scripts in scene");
  await scripts.selectOption("gaon-iris-iris-elevator");
  await page.reload();
  await page.locator(".scene-settings summary").click();
  await expect(
    page.locator(".scene-settings").getByLabel("Project GUID"),
  ).toHaveValue("shared-stage-room");
  await expect(
    page.locator(".cueform fieldset").getByLabel("Project GUID"),
  ).toHaveCount(0);
  await scripts.selectOption("gaon-iris-gaon-elevator");
  await page.locator(".editcue").nth(5).click();
  const table = page.locator("table.actionlist");
  const buttons = table.locator(".action-delete button");
  await expect(buttons).toHaveCount(3);
  const check = async () => {
    expect(
      await table.evaluate((t) => {
        const cells = [...t.querySelectorAll("tr")].map((r) =>
          r.querySelector(".action-delete button")!.getBoundingClientRect(),
        );
        return cells.every(
          (r) =>
            Math.abs(r.right - cells[0].right) < 1 &&
            Math.abs(r.right - t.getBoundingClientRect().right) < 10,
        );
      }),
    ).toBe(true);
  };
  await check();
  await page.getByRole("button", { name: "General settings" }).click();
  await page.locator("dialog select").selectOption("he");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await check();
  await expect(buttons.first()).toHaveText("");
});

test("reordered actions persist and play from top to bottom", async ({
  page,
}) => {
  await page.goto("/#editor");
  const rows = page.locator("table.actionlist tr");
  const up = (i: number) =>
    rows.nth(i).getByRole("button", { name: "Move action up" });
  const down = (i: number) =>
    rows.nth(i).getByRole("button", { name: "Move action down" });
  await expect(up(0)).toBeDisabled();
  await expect(down(0)).toBeDisabled();
  for (const asset of ["ari-2", "ari-3"]) {
    await page.getByLabel("Action type").selectOption("play_audio");
    await page.getByRole("button", { name: "Add action", exact: true }).click();
    await page.getByLabel("Media file").last().selectOption(asset);
  }
  await up(2).click();
  await down(0).click();
  await expect(up(0)).toBeDisabled();
  await expect(down(2)).toBeDisabled();
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await expect(rows.locator("select option:checked")).toHaveText([
    "ari-3.wav",
    "ari-1.wav",
    "ari-2.wav",
  ]);
  const played: string[] = [];
  await page.exposeFunction("recordClip", (url: string) =>
    played.push(new URL(url).pathname.split("/").pop()!),
  );
  await page.evaluate(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      void (
        window as unknown as { recordClip: (src: string) => Promise<void> }
      ).recordClip(this.src);
      return play.call(this);
    };
  });
  await page.getByRole("button", { name: "Test cue", exact: true }).click();
  await expect
    .poll(() => played, { timeout: 20000 })
    .toEqual(["ari-3.wav", "ari-1.wav", "ari-2.wav"]);
});

test("alternative phrasing rows save independently and action controls line up", async ({
  page,
}) => {
  await page.goto("/#editor");
  const group = page.getByRole("group", { name: "Alternative phrasings" });
  const inputs = group.getByRole("textbox");
  const add = group.getByRole("button", { name: "Add phrasing" });
  await expect(inputs.first()).toHaveValue("היי ארי");
  for (const text of ["שלום לך", "הי ארי"]) {
    await add.click();
    await expect(inputs.last()).toBeFocused();
    await inputs.last().fill(text);
  }
  await group.getByRole("button", { name: "Remove phrasing 2" }).click();
  await add.click();
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toHaveValue("היי ארי");
  await expect(inputs.nth(1)).toHaveValue("הי ארי");
  await group.getByRole("button", { name: "Remove phrasing 1" }).click();
  await group.getByRole("button", { name: "Remove phrasing 1" }).click();
  await expect(inputs).toHaveCount(0);
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await expect(inputs).toHaveCount(0);
  for (const lang of ["en", "he"]) {
    if (lang === "he") {
      await page.getByRole("button", { name: "General settings" }).click();
      await page.locator("dialog select").selectOption("he");
      await page.keyboard.press("Escape");
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      expect(
        await page.locator(".action-picker").evaluate((p) => {
          const a = p.querySelector("select")!.getBoundingClientRect();
          const b = p.querySelector("button")!.getBoundingClientRect();
          return (
            a.top === b.top &&
            a.bottom === b.bottom &&
            (a.right <= b.left || b.right <= a.left)
          );
        }),
      ).toBe(true);
    }
  }
});

test("generic media and fractional wait actions round-trip in a scene", async ({
  page,
}) => {
  await page.goto("/#editor");
  const source = await (await page.request.get("/assets/ari-1.wav")).body();
  const picker = page.getByLabel("Action type");
  await expect(picker.locator("option")).toHaveText([
    "Play audio",
    "Text to speech",
    "Show image",
    "Play video",
    "Wait",
    "YouTube clip",
    "SceneMax broadcast",
  ]);
  await picker.selectOption("wait");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await page.getByLabel("Wait (seconds)").fill("0.275");
  await picker.selectOption("play_audio");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await page.locator(".action-media input[type=file]").last().setInputFiles({
    name: "my rehearsal.wav",
    mimeType: "audio/wav",
    buffer: source,
  });
  await expect(
    page.getByLabel("Media file").last().locator("option:checked"),
  ).toHaveText("my rehearsal.wav");
  await page.getByRole("button", { name: "Save scene" }).click();
  await page.reload();
  await expect(page.getByLabel("Wait (seconds)")).toHaveValue("0.275");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Scene File" }).click();
  const file = await pending;
  await page
    .locator('input[accept=".srs"]')
    .setInputFiles((await file.path())!);
  await expect(page.getByLabel("Active scene").locator("option")).toHaveCount(
    4,
  );
  await expect(page.getByLabel("Wait (seconds)")).toHaveValue("0.275");
  await expect(
    page.getByLabel("Media file").last().locator("option:checked"),
  ).toHaveText("my rehearsal.wav");
  await page.getByRole("button", { name: "Test cue", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Cue test complete", {
    timeout: 20000,
  });
});

test("scene script controls align in English and Hebrew", async ({ page }) => {
  await page.goto("/#editor");
  for (const language of ["en", "he"]) {
    if (language === "he") {
      await page.getByRole("button", { name: "General settings" }).click();
      await page.locator("dialog select").selectOption("he");
      await page.keyboard.press("Escape");
    }
    for (const width of [1280, 720, 390]) {
      await page.setViewportSize({ width, height: 850 });
      const aligned = await page.locator(".scene-scripts").evaluate((el) => {
        const rects = Array.from(el.querySelectorAll("select,button"), (n) =>
          n.getBoundingClientRect(),
        );
        const [combo, add, duplicate] = rects;
        return (
          add.top === duplicate.top &&
          add.bottom === duplicate.bottom &&
          (innerWidth <= 530
            ? combo.bottom <= add.top
            : combo.top === add.top && combo.bottom === add.bottom) &&
          rects.every((r) => r.left >= 0 && r.right <= innerWidth)
        );
      });
      expect(aligned).toBe(true);
    }
  }
});

test("authored Hebrew speech survives sharing and plays without synthesis", async ({
  page,
  browser,
}) => {
  await page.goto("/#editor");
  await page.getByRole("button", { name: "New scene", exact: true }).click();
  await page.getByLabel("Turn type").selectOption("virtual_line");
  await page.getByLabel("Action type").selectOption("text_to_speech");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  await page.getByLabel("Spoken text").fill("שלום איריס");
  await page.getByRole("button", { name: "Generate speech" }).click();
  await expect(page.getByRole("button", { name: "Speech ready" })).toBeVisible({
    timeout: 40000,
  });
  await page.getByRole("combobox", { name: "Voice", exact: true }).selectOption("omer");
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("slider", { name: "Speaking speed" })
      .press("ArrowRight");
  for (let i = 0; i < 2; i++)
    await page
      .getByRole("slider", { name: "Pitch (semitones)" })
      .press("ArrowLeft");
  await page.getByLabel("Spoken text").fill("שלום גאון");
  await expect(page.getByRole("button", { name: "Save scene" })).toBeDisabled();
  await page.getByRole("button", { name: "Generate speech" }).click();
  await expect(page.getByRole("button", { name: "Speech ready" })).toBeVisible({
    timeout: 40000,
  });
  await page.getByRole("button", { name: "Save scene" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Scene File" }).click();
  const path = await (await pending).path();
  const student = await browser.newContext();
  try {
    const p = await student.newPage();
    await p.goto(page.url());
    await p.route("**/api/speech", (r) => r.abort());
    await p.locator('input[accept=".srs"]').setInputFiles(path!);
    await expect(p.getByLabel("Spoken text")).toHaveValue("שלום גאון");
    await expect(p.getByRole("combobox", { name: "Voice", exact: true })).toHaveValue("omer");
    await expect(p.getByRole("slider", { name: "Speaking speed" })).toHaveValue(
      "1.2",
    );
    await expect(
      p.getByRole("slider", { name: "Pitch (semitones)" }),
    ).toHaveValue("-2");
    await p.getByRole("button", { name: "Test cue", exact: true }).click();
    await expect(p.getByRole("status")).toContainText("Cue test complete", {
      timeout: 10000,
    });
  } finally {
    await student.close();
  }
});

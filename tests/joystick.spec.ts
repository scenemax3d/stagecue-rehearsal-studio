import { test, expect } from "@playwright/test";

test("a saved controller press fires one simulator cue per release", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [
        {
          id: "Test joystick",
          index: 0,
          connected: true,
          buttons: [{ pressed: document.body?.dataset.down === "yes" }],
        },
      ],
    });
  });
  const press = (down: boolean) =>
    page.evaluate((v) => {
      document.body.dataset.down = v ? "yes" : "no";
    }, down);
  await page.goto("/#player");
  await page.getByRole("button", { name: "General settings" }).click();
  await page
    .getByRole("button", { name: "Assign button", exact: true })
    .click();
  await press(true);
  await expect(page.getByRole("dialog")).toContainText(
    "Test joystick · Button 1",
  );
  await press(false);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "General settings" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Test joystick · Button 1",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("Input source").selectOption("mock");
  await page
    .locator(".transport").getByRole("button", { name: "Start rehearsal", exact: true })
    .click();
  await press(true);
  await expect(page.locator(".cue.current .num")).toHaveText("02", {
    timeout: 12000,
  });
  await page.waitForTimeout(350);
  await expect(
    page.locator(".entry").filter({ hasText: "Cue fired" }),
  ).toHaveCount(1);
  await press(false);
  await page.waitForTimeout(80);
  await press(true);
  await expect(
    page.locator(".entry").filter({ hasText: "Cue fired" }),
  ).toHaveCount(2);
});

import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAccessibilityProblems } from "./accessibility";

// Signs up someone new and opens a new board in a new project.
async function openNewBoard(page: Page) {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ben");
  await page.getByLabel("Email").fill(`ben-${run}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("a long enough password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Create your first project" }).click();
  const project = page.getByRole("dialog", { name: "New project" });
  await project.getByLabel("Name").fill(`Board test ${run}`);
  await expect(project.getByLabel("Code")).not.toHaveValue("");
  await project.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "Create your first board" }).click();
  const board = page.getByRole("dialog", { name: "New board" });
  await board.getByLabel("Name").fill("Sprint 1");
  await board.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sprint 1" }),
  ).toBeVisible();
}

async function addCard(page: Page, column: string, title: string) {
  const region = page.getByRole("region", { name: column });
  await region.getByRole("button", { name: "Add a card" }).click();
  await region.getByLabel("Card title").fill(title);
  await region.getByRole("button", { name: "Add" }).click();
  await expect(
    region.getByRole("button", { name: new RegExp(`-\\d+ ${title}$`) }),
  ).toBeVisible();
  await region.getByRole("button", { name: "Cancel" }).click();
}

// Presses a key while a card is being moved, until the expected step is
// read out. In CI an arrow pressed straight after Space picked the card up
// was sometimes ignored (probably dnd-kit still measuring the columns; a
// person never presses that fast). The key is pressed again only while the
// announcement does not yet show the expected step, and at most three
// times, so a key that is always lost still fails the test.
async function moveUntil(
  page: Page,
  announcement: Locator,
  key: string,
  expected: RegExp,
) {
  let presses = 0;
  await expect(async () => {
    if (!expected.test((await announcement.textContent()) ?? "")) {
      expect(presses, `${key} was not read out`).toBeLessThan(3);
      presses += 1;
      await page.keyboard.press(key);
    }
    await expect(announcement).toHaveText(expected, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

function card(page: Page, column: string, title: string) {
  return page
    .getByRole("region", { name: column })
    .getByRole("button", { name: new RegExp(`-\\d+ ${title}$`) });
}

test("add cards and drag one to another column", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await addCard(page, "To do", "Sign-up page");
  await expectNoAccessibilityProblems(page);

  const login = card(page, "To do", "Login page");
  const target = page
    .getByRole("region", { name: "In progress" })
    .getByText("No cards");
  const from = (await login.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Several steps, so the drag starts and passes over the column.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();

  await expect(card(page, "In progress", "Login page")).toBeVisible();
  await page.reload();
  await expect(card(page, "In progress", "Login page")).toBeVisible();
  await expect(card(page, "To do", "Sign-up page")).toBeVisible();
});

test("move a card with the keyboard", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await addCard(page, "To do", "Sign-up page");

  // Space picks the card up, the arrow keys move it, Space drops it. Each
  // step is read out, so wait for it as a screen reader user would.
  const announcement = page.getByRole("status");
  await card(page, "To do", "Sign-up page").focus();
  await page.keyboard.press("Space");
  await expect(announcement).toHaveText(/is in To do, place 2 of 2/);
  await moveUntil(page, announcement, "ArrowUp", /is in To do, place 1 of 2/);
  await page.keyboard.press("Space");

  const toDo = page.getByRole("region", { name: "To do" });
  await expect(toDo.getByRole("button", { name: /^\w+-\d+ / })).toHaveText([
    /Sign-up page/,
    /Login page/,
  ]);
  await page.reload();
  await expect(toDo.getByRole("button", { name: /^\w+-\d+ / })).toHaveText([
    /Sign-up page/,
    /Login page/,
  ]);

  await card(page, "To do", "Login page").focus();
  await page.keyboard.press("Space");
  await expect(announcement).toHaveText(/is in To do, place 2 of 2/);
  await moveUntil(page, announcement, "ArrowRight", /is in In progress/);
  // Enter neither drops the card nor selects it while it is being moved.
  await page.keyboard.press("Enter");
  await expect(announcement).toHaveText(/is in In progress/);
  expect(page.url()).not.toContain("card=");
  await page.keyboard.press("Space");
  await expect(announcement).toHaveText(/was dropped in In progress/);
  await expect(card(page, "In progress", "Login page")).toBeVisible();
});

test("open a chat, dock it on the left and resize it", async ({ page }) => {
  await openNewBoard(page);

  await page
    .getByRole("navigation", { name: "Chats" })
    .getByRole("link", { name: "General" })
    .click();
  const panel = page.getByRole("complementary", { name: "Chat: General" });
  await expect(panel).toContainText("Messages are coming soon");
  await expectNoAccessibilityProblems(page);

  await panel.getByRole("button", { name: "Dock the panel" }).click();
  await page.getByRole("menuitemradio", { name: "Left" }).click();
  const board = page.getByRole("heading", { level: 1, name: "Sprint 1" });
  expect((await panel.boundingBox())!.x).toBeLessThan(
    (await board.boundingBox())!.x,
  );

  const width = (await panel.boundingBox())!.width;
  await page.getByRole("separator", { name: "Resize the chat panel" }).focus();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(width);

  await page.reload();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBeLessThan(
    (await board.boundingBox())!.x,
  );
});

test("start a chat, make a card for it, then unlink and link it again", async ({
  page,
}) => {
  await openNewBoard(page);
  await page.getByRole("button", { name: "New chat" }).click();
  const dialog = page.getByRole("dialog", { name: "New chat" });
  await dialog.getByLabel("Title").fill("Release plan");
  await dialog.getByRole("button", { name: "Start" }).click();

  const panel = page.getByRole("complementary", {
    name: "Chat: Release plan",
  });
  await expect(panel).toContainText("Create a card for this chat?");
  await expectNoAccessibilityProblems(page);
  await panel.getByRole("button", { name: "Create a card" }).click();
  await expect(card(page, "To do", "Release plan")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/);

  await panel.getByRole("button", { name: /^Unlink from / }).click();
  await expect(panel).toContainText("Create a card for this chat?");

  await panel.getByRole("button", { name: "Link to a card" }).click();
  const picker = page.getByRole("dialog", { name: "Link to a card" });
  await picker.getByLabel("Find a card").fill("release");
  await picker.getByRole("button", { name: /Release plan$/ }).click();
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/);
  await page.reload();
  await expect(panel).toContainText(/For card \w+-\d+ Release plan/);
});

test("open a card and change it in the card panel", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");

  await card(page, "To do", "Login page").click();
  const panel = page.getByRole("complementary", { name: /^Card / });
  await expect(panel.getByLabel("Title")).toHaveValue("Login page");
  await expectNoAccessibilityProblems(page);

  await panel.getByLabel("Title").fill("Sign-in page");
  await panel.getByLabel("Title").press("Enter");
  await panel.getByLabel("Priority").selectOption("High");
  await panel.getByRole("button", { name: "Assign" }).click();
  await page.getByRole("button", { name: "Ben", exact: true }).click();
  await panel.getByRole("button", { name: "Add label" }).click();
  await page.getByLabel("Find a label").fill("Frontend");
  await page.getByRole("button", { name: "Create label “Frontend”" }).click();
  await panel.getByText("Blue", { exact: true }).click();
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Labels" })).toHaveText(
    /Frontend/,
  );

  await panel.getByRole("button", { name: "Edit description" }).click();
  await panel.getByRole("button", { name: "Bold" }).click();
  await panel
    .getByRole("textbox", { name: "Description" })
    .pressSequentially("Check the form");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(
    panel.locator("strong", { hasText: "Check the form" }),
  ).toBeVisible();

  // Not check(): the tick shows once the change is on its way, a moment
  // after the click.
  await panel.getByRole("checkbox", { name: "Complete" }).click();
  await expect(panel.getByRole("checkbox", { name: "Complete" })).toBeChecked();
  await panel.getByRole("button", { name: "Move to Done" }).click();
  await expect(card(page, "Done", "Sign-in page")).toBeVisible();
  await expectNoAccessibilityProblems(page);

  // Everything was saved.
  await page.reload();
  await expect(panel.getByLabel("Priority")).toHaveValue("HIGH");
  await expect(panel.getByRole("list", { name: "Assignees" })).toHaveText(
    /Ben\s*Owner/,
  );
  await expect(
    panel.locator("strong", { hasText: "Check the form" }),
  ).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "Complete" })).toBeChecked();

  await panel.getByRole("button", { name: "Delete card" }).click();
  const dialog = page.getByRole("dialog", { name: /^Delete / });
  await dialog.getByRole("button", { name: "Delete card" }).click();
  await expect(panel).toBeHidden();
  await expect(card(page, "Done", "Sign-in page")).toBeHidden();
});

test("see an open card’s relatives on the board", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await card(page, "To do", "Login page").click();
  const parentId = new URL(page.url()).searchParams.get("card")!;
  const columnId = (
    (await (await page.request.get(`/api/cards/${parentId}`)).json()) as {
      columnId: string;
    }
  ).columnId;
  // Subtasks get their own screens in the next pull request; the API
  // makes this one.
  await page.request.post(`/api/cards/${parentId}/subtasks`, {
    data: { columnId, title: "Form" },
  });
  await page.reload();

  await page
    .getByRole("region", { name: "To do" })
    .getByRole("button", { name: /-1\.1 Form$/ })
    .click();

  const parent = card(page, "To do", "Login page");
  await expect(parent).toHaveAccessibleDescription(/Parent of the open card/);
  await expect(
    page.getByRole("region", { name: "To do" }).getByText("Parent", {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoAccessibilityProblems(page);
});

// Web PR 7a and 7b, criterion 46 (its checklist and subtask parts).
test("add a checklist to a card, tick an item and turn another into a subtask", async ({
  page,
}) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await card(page, "To do", "Login page").click();
  const panel = page.getByRole("complementary", { name: /^Card / });

  await panel.getByRole("button", { name: "Add checklist" }).click();
  await panel.getByLabel("Checklist name").fill("Testing");
  await panel.getByLabel("Checklist name").press("Enter");
  const list = panel.getByRole("region", { name: "Testing" });
  await list.getByRole("button", { name: "Add item" }).click();
  const box = list.getByLabel("New item");
  for (const text of ["Check the form", "Write tests"]) {
    await box.fill(text);
    await box.press("Enter");
    await expect(list.getByRole("checkbox", { name: text })).toBeVisible();
  }

  // Not check(): the tick shows once the change is on its way.
  await list.getByRole("checkbox", { name: "Check the form" }).click();
  await expect(
    list.getByRole("checkbox", { name: "Check the form" }),
  ).toBeChecked();
  await expect(list).toContainText("1 of 2");
  await expectNoAccessibilityProblems(page);

  await list
    .getByRole("button", { name: /Write tests/ })
    .and(page.locator('[aria-haspopup="menu"]'))
    .click();
  await page.getByRole("menuitem", { name: "Turn into subtask" }).click();
  await expect(list.getByRole("checkbox", { name: "Write tests" })).toHaveCount(
    0,
  );
  await expect(
    page
      .getByRole("region", { name: "To do" })
      .getByRole("button", { name: /-1\.1 Write tests$/ }),
  ).toBeVisible();
  // Web PR 7b: the item turned into a subtask is in the Subtasks section,
  // and another subtask can be added there.
  const subtasks = panel.getByRole("region", { name: "Subtasks" });
  await expect(subtasks).toContainText("Write tests");
  await expect(subtasks).toContainText("0 of 1 complete");
  await subtasks.getByRole("button", { name: "Add subtask" }).click();
  await subtasks.getByRole("textbox", { name: /title/i }).fill("Review");
  await subtasks.getByRole("textbox", { name: /title/i }).press("Enter");
  await expect(subtasks).toContainText("Review");
  await expect(subtasks).toContainText("0 of 2 complete");
  await expect(
    page
      .getByRole("region", { name: "To do" })
      .getByRole("button", { name: /-1\.2 Review$/ }),
  ).toBeVisible();
  await expectNoAccessibilityProblems(page);

  // Everything was saved.
  await page.reload();
  await expect(
    list.getByRole("checkbox", { name: "Check the form" }),
  ).toBeChecked();
  await expect(list.getByRole("checkbox", { name: "Write tests" })).toHaveCount(
    0,
  );
  await expect(list).toContainText("1 of 1");
  await expect(subtasks).toContainText("Write tests");
  await expect(subtasks).toContainText("Review");
});

// Web PR 7c, criterion 46 (its time part).
test("start and stop the timer, and log time by hand", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await card(page, "To do", "Login page").click();
  const panel = page.getByRole("complementary", { name: /^Card / });
  const time = panel.getByRole("region", { name: "Time" });

  // The chip in the top bar follows the timer. (Wording agreed 2026-11-07.)
  await time.getByRole("button", { name: "Start timer" }).click();
  const chip = page.getByRole("group", { name: "Running timer" });
  await expect(chip).toContainText(/-\d+/);
  await expect(chip.getByText(/^\d+:\d{2}:\d{2}$/)).toBeVisible();
  await expectNoAccessibilityProblems(page);

  // Stopped at once, it ran under half a minute and nothing is saved.
  await time.getByRole("button", { name: "Stop timer" }).click();
  await expect(panel).toContainText("Under half a minute, nothing saved");
  await expect(chip).toBeHidden();
  await expect(time.getByRole("button", { name: "Start timer" })).toBeVisible();

  await time.getByRole("button", { name: "Log time" }).click();
  await time.getByLabel("Minutes").fill("30");
  await time.getByLabel("Note").fill("Checked the form");
  await time.getByRole("button", { name: "Save" }).click();
  const entries = time.getByRole("list", { name: "Entries" });
  await expect(entries).toContainText("Checked the form");
  await expect(entries).toContainText("Ben");
  await expect(entries).toContainText("30m");
  await expect(time).toContainText(/Time spent\s*30m/);
  await expectNoAccessibilityProblems(page);

  // Everything was saved.
  await page.reload();
  await expect(
    panel
      .getByRole("region", { name: "Time" })
      .getByRole("list", { name: "Entries" }),
  ).toContainText("Checked the form");
});

// Web PR 7d, criterion 46 (its activity part): the lines for what was done
// in the card panel, in the Activity tab. (Tab and list names agreed 2026-11-08.)
test("see what was done to a card in the Activity tab", async ({ page }) => {
  await openNewBoard(page);
  await addCard(page, "To do", "Login page");
  await card(page, "To do", "Login page").click();
  const panel = page.getByRole("complementary", { name: /^Card / });

  await panel.getByLabel("Priority").selectOption("High");
  await expect(panel.getByLabel("Priority")).toHaveValue("HIGH");
  await panel.getByRole("button", { name: "Add checklist" }).click();
  await panel.getByLabel("Checklist name").fill("Testing");
  await panel.getByLabel("Checklist name").press("Enter");
  const list = panel.getByRole("region", { name: "Testing" });
  await list.getByRole("button", { name: "Add item" }).click();
  await list.getByLabel("New item").fill("Write tests");
  await list.getByLabel("New item").press("Enter");
  await list
    .getByRole("button", { name: /Write tests/ })
    .and(page.locator('[aria-haspopup="menu"]'))
    .click();
  await page.getByRole("menuitem", { name: "Turn into subtask" }).click();
  await expect(list.getByRole("checkbox", { name: "Write tests" })).toHaveCount(
    0,
  );
  const time = panel.getByRole("region", { name: "Time" });
  await time.getByRole("button", { name: "Log time" }).click();
  await time.getByLabel("Minutes").fill("30");
  await time.getByRole("button", { name: "Save" }).click();
  await expect(time.getByRole("list", { name: "Entries" })).toContainText(
    "30m",
  );

  await panel.getByRole("tab", { name: "Activity" }).click();
  const lines = panel
    .getByRole("tabpanel", { name: "Activity" })
    .getByRole("list", { name: "Activity" });
  // Newest first, each with who and when.
  await expect(lines.getByRole("listitem")).toHaveText([
    /Ben\s*logged 30m for \d+ \w{3}\s*(just now|\d+ seconds? ago|\d+ minutes? ago|now)/,
    /Ben\s*turned .Write tests. from Testing into \w+-1\.1/,
    /Ben\s*added the checklist .Testing./,
    /Ben\s*changed the priority from None to High/,
    /Ben\s*created this card as \w+-1/,
  ]);
  await expect(lines.locator("time").first()).toHaveAttribute("datetime", /./);
  await expect(panel.getByRole("button", { name: "Show older" })).toHaveCount(
    0,
  );
  await expectNoAccessibilityProblems(page);

  // Back to Details, and the history is still there after a reload.
  await panel.getByRole("tab", { name: "Details" }).click();
  await expect(panel.getByLabel("Title")).toHaveValue("Login page");
  await page.reload();
  await panel.getByRole("tab", { name: "Activity" }).click();
  await expect(lines.getByRole("listitem")).toHaveCount(5);
});

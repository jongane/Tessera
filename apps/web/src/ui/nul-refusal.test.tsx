import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { cardPanel, login, openCard } from "../test/card-panel";
import { checklist } from "../test/fake-checklists";
import { website } from "../test/fixtures";
import { renderApp } from "../test/render";
import { ana, server, signedInAs, signUpOpen } from "../test/server";

// A NUL character (U+0000) is invisible and PostgreSQL cannot store it. Every
// form that saves text shows this message under the field and sends nothing
// (plan "refuse NUL characters in text fields", criterion 4). The rule comes
// from the shared schemas, so these tests cover one form of each kind.
// The message uses the typographic apostrophe, like “This can’t be empty”.
const NUL_MESSAGE = "This contains a hidden character that can’t be saved";

// A NUL cannot be typed on a keyboard, so it arrives as a paste, as it would
// from some programs.
const withNul = (text: string) => text.replace("^", "\u0000");

describe("A hidden NUL character in a form", () => {
  // Criterion 4: a dialog.
  it("is refused in the New board dialog, which sends nothing", async () => {
    const posted: unknown[] = [];
    server.use(
      signedInAs(ana),
      http.get("/api/projects/by-code/WEB", () => HttpResponse.json(website)),
      http.get(`/api/projects/${website.id}/boards`, () =>
        HttpResponse.json([]),
      ),
      http.post(`/api/projects/${website.id}/boards`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { user } = renderApp("/WEB");
    await user.click(
      await screen.findByRole("button", { name: "Create your first board" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "New board" });
    const name = within(dialog).getByLabelText("Name");

    await user.click(name);
    await user.paste(withNul("Sprint^ 2"));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await within(dialog).findByText(NUL_MESSAGE)).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  // Criterion 4: an inline edit (the card title).
  it("is refused in the card title, which sends nothing", async () => {
    const { user, api } = openCard();
    const panel = await cardPanel();
    const title = within(panel).getByLabelText("Title");

    await user.clear(title);
    await user.paste(withNul("Sign^in page"));
    await user.tab();

    expect(await within(panel).findByText(NUL_MESSAGE)).toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  // Criterion 4: an inline add (a checklist item).
  it("is refused in a new checklist item, which sends nothing", async () => {
    const testing = checklist("Testing", ["Chrome"]);
    const { user, api } = openCard(login, {
      checklists: { [login.id]: [testing] },
    });
    const list = await within(await cardPanel()).findByRole("region", {
      name: "Testing",
    });

    await user.click(within(list).getByRole("button", { name: "Add item" }));
    const box = within(list).getByRole("textbox", { name: "New item" });
    box.focus();
    await user.paste(withNul("Saf^ari"));
    await user.keyboard("{Enter}");

    expect(await within(list).findByText(NUL_MESSAGE)).toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  // Criterion 4: the card description (a rich text editor).
  it("is refused in the card description, which sends nothing", async () => {
    const { user, api } = openCard();
    const panel = await cardPanel();
    await user.click(
      within(panel).getByRole("button", { name: "Edit description" }),
    );
    const editor = await within(panel).findByRole("textbox", {
      name: "Description",
    });

    editor.focus();
    await user.paste(withNul("Check^ the form"));
    await user.click(within(panel).getByRole("button", { name: "Save" }));

    expect(await within(panel).findByText(NUL_MESSAGE)).toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  // Criteria 4 and 6: the new password on the sign-up form.
  it("is refused in the sign-up password, which sends nothing", async () => {
    const posted: unknown[] = [];
    server.use(
      signedInAs(null),
      signUpOpen(true),
      http.post("/api/auth/sign-up", async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json(ana, { status: 201 });
      }),
    );
    const { user } = renderApp("/sign-up");

    await user.type(await screen.findByLabelText("Your name"), "Ana");
    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.click(screen.getByLabelText("Password"));
    await user.paste(withNul("long enough^ pass"));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText(NUL_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(posted).toEqual([]));
  });
});

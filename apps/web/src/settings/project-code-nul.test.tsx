import type { ProjectMember } from "@tessera/shared";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { website } from "../test/fixtures";
import { renderApp } from "../test/render";
import { ana, server, signedInAs } from "../test/server";

// Plan "refuse NUL characters in text fields", criterion 4: each web form
// that saves text shows the agreed message under the field and sends
// nothing. The Change code dialog checks with the shared rules.
const NUL_MESSAGE = "This contains a hidden character that can’t be saved";

describe("A hidden NUL character in the project code", () => {
  it("is refused in the Change code dialog, which sends nothing", async () => {
    const sent: unknown[] = [];
    const admin: ProjectMember = {
      userId: ana.id,
      displayName: ana.displayName,
      email: ana.email,
      role: "ADMIN",
      joinedAt: "2026-10-30T09:00:00.000Z",
    };
    server.use(
      signedInAs(ana),
      http.get("/api/projects/by-code/WEB", () => HttpResponse.json(website)),
      http.get(`/api/projects/${website.id}/members`, () =>
        HttpResponse.json([admin]),
      ),
      http.get(`/api/projects/${website.id}/labels`, () =>
        HttpResponse.json([]),
      ),
      http.patch(`/api/projects/${website.id}`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ message: NUL_MESSAGE }, { status: 400 });
      }),
    );
    const { user } = renderApp("/WEB/settings");

    const code = await screen.findByRole("region", { name: "Project code" });
    await user.click(within(code).getByRole("button", { name: "Change code" }));
    const dialog = screen.getByRole("dialog", {
      name: "Change the project code?",
    });
    const field = within(dialog).getByRole("textbox", { name: "New code" });
    await user.clear(field);
    await user.paste("SI\u0000TE");
    await user.click(
      within(dialog).getByRole("button", { name: "Change code" }),
    );

    expect(await within(dialog).findByText(NUL_MESSAGE)).toBeInTheDocument();
    expect(sent).toEqual([]);
  });
});

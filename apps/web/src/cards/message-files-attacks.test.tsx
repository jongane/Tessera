import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { boardPath, cardPanel } from "../test/card-panel";
import { fakeBoard } from "../test/fake-board";
import { messageFile } from "../test/fake-files";
import { boardCard, boardColumn, boardView } from "../test/fixtures";
import { renderApp } from "../test/render";
import { server } from "../test/server";

// Antagonist proof test for files on messages (PR B): criterion 23 and the
// plan's risk 3 ("Counting chat files would make every card with a chat file
// impossible to delete (an endless 409)"). The Delete card dialog counts only
// the open card's own files, but a subtask chosen for deletion is still
// counted with every file in its list, which now includes the files of the
// subtask's chat. The API counts card files only (cardId), so filesSeen never
// matches and the delete is refused with 409 every time.

const todoId = "88888888-8888-4888-8888-000000000001";
const doneId = "88888888-8888-4888-8888-000000000002";

describe("Delete card dialog: a subtask whose chat has files (criterion 23)", () => {
  it("does not count the files of a deleted subtask’s chat, so no files choice and no filesSeen is sent", async () => {
    const login = boardCard("12", "Login page");
    const form = {
      ...boardCard("12.1", "Form", { depth: 1 }),
      parentId: login.id,
    };
    const parent = { ...login, subtaskProgress: { complete: 0, total: 1 } };
    const api = fakeBoard(
      boardView([
        boardColumn("To do", [parent, form], { id: todoId }),
        boardColumn("Done", [], { id: doneId, isDone: true }),
      ]),
    );
    // The subtask has no file of its own; its chat has one message file.
    server.use(
      http.get(`/api/cards/${form.id}/files`, () =>
        HttpResponse.json({
          files: [messageFile("chat.pdf", "chat-of-form", "msg-1")],
        }),
      ),
    );
    const { user } = renderApp(`${boardPath}?card=${parent.id}`);
    const panel = await cardPanel();

    await user.click(
      await within(panel).findByRole("button", { name: "Delete card" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete WEB-12?" });
    const group = await within(dialog).findByRole("radiogroup", {
      name: "WEB-12.1 Form",
    });
    await user.click(within(group).getByRole("radio", { name: "Delete" }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      within(dialog).queryByRole("radio", { name: "Delete the files too" }),
      "the subtask has no files of its own",
    ).toBe(null);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete card" }),
    );
    await waitFor(() =>
      expect(api.requests.map((r) => r.request)).toContain(
        `DELETE /api/cards/${parent.id}`,
      ),
    );
    const deletion = api.requests.find((r) => r.request.startsWith("DELETE"))!;
    expect(deletion.body).not.toHaveProperty("filesSeen");
  });
});

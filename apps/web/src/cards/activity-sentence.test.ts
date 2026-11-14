import type { ActivityKind, ActivityLine } from "@tessera/shared";
import { describe, expect, it } from "vitest";
import { activityLine } from "../test/fake-activity";
import { activitySentence } from "./activity-sentence";

// Web PR 7d: the sentence for each kind of history line (acceptance
// criteria 39 and 41; the table of 25 kinds in pr7-acceptance-criteria.md,
// “Proposed Activity sentences”). A sentence starts with the person's name,
// as the Activity tab shows it.
//
// Where the table gives only the shape (“set/changed/removed the due date”)
// the exact words below are agreed 2026-11-08 (marked “agreed 2026-11-08”).

// What the sentence needs besides the line: the project's code (numbers),
// its time zone (due times, and which year is “this year”), and the clock.
// (agreed 2026-11-08: this signature)
const context = {
  projectCode: "WEB",
  timeZone: "Europe/London",
  now: new Date("2026-11-07T10:00:00.000Z"),
};

const jon = { id: "jon", displayName: "Jon" };
const sam = { id: "sam", displayName: "Sam" };

function ref(numberPath: string, title: string) {
  return { id: `card-${numberPath}`, numberPath, title };
}

// The sentence with curly quotes made plain, so the wording is checked and
// not the kind of quote.
function sentence(line: ActivityLine) {
  return activitySentence(line, context)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

// Every kind the API records. If a kind is added to or removed from the
// shared types, the two checks below stop this file compiling, so a
// sentence (and its test) has to be written for it.
const ALL_KINDS = [
  "CREATED",
  "TITLE_CHANGED",
  "DESCRIPTION_CHANGED",
  "PRIORITY_CHANGED",
  "DUE_DATE_CHANGED",
  "ESTIMATE_CHANGED",
  "MOVED",
  "COMPLETED",
  "REOPENED",
  "ASSIGNEE_ADDED",
  "ASSIGNEE_REMOVED",
  "OWNER_CHANGED",
  "LABEL_ADDED",
  "LABEL_REMOVED",
  "SUBTASK_ADDED",
  "SUBTASK_REMOVED",
  "PARENT_CHANGED",
  "NUMBER_CHANGED",
  "TIME_LOGGED",
  "TIME_ENTRY_EDITED",
  "TIME_ENTRY_DELETED",
  "CHECKLIST_ADDED",
  "CHECKLIST_RENAMED",
  "CHECKLIST_DELETED",
  "CHECKLIST_ITEM_TO_SUBTASK",
  "FILE_ADDED",
  "FILE_REMOVED",
  "FILE_MOVED",
] as const satisfies readonly ActivityKind[];

type Missing = Exclude<ActivityKind, (typeof ALL_KINDS)[number]>;
// Fails to compile when the shared types have a kind not listed above.
const everyKindIsListed: [Missing] extends [never] ? true : never = true;

// One line of each kind, with the sentence it must give (criterion 39).
const CASES: [ActivityKind, ActivityLine, string][] = [
  [
    "CREATED",
    activityLine(
      "CREATED",
      { numberPath: "12", title: "Login" },
      { actor: jon },
    ),
    "Jon created this card as WEB-12",
  ],
  [
    "TITLE_CHANGED",
    activityLine("TITLE_CHANGED", { from: "A", to: "B" }, { actor: jon }),
    "Jon renamed this from 'A' to 'B'",
  ],
  [
    "DESCRIPTION_CHANGED",
    activityLine(
      "DESCRIPTION_CHANGED",
      { from: "Old", to: "New" },
      { actor: jon },
    ),
    // The old and new text are behind the “Show changes” button, not here.
    "Jon changed the description",
  ],
  [
    "PRIORITY_CHANGED",
    activityLine(
      "PRIORITY_CHANGED",
      { from: "LOW", to: "HIGH" },
      { actor: jon },
    ),
    "Jon changed the priority from Low to High",
  ],
  [
    "DUE_DATE_CHANGED",
    activityLine(
      "DUE_DATE_CHANGED",
      {
        from: { at: null, hasTime: false },
        to: { at: "2026-11-04T17:00:00.000Z", hasTime: true },
      },
      { actor: jon },
    ),
    "Jon set the due date to 4 Nov, 17:00 Europe/London",
  ],
  [
    "ESTIMATE_CHANGED",
    activityLine("ESTIMATE_CHANGED", { from: 120, to: 210 }, { actor: jon }),
    "Jon changed the estimate from 2h to 3h 30m",
  ],
  [
    "MOVED",
    activityLine(
      "MOVED",
      {
        from: { columnId: "c1", name: "To do" },
        to: { columnId: "c2", name: "In progress" },
      },
      { actor: jon },
    ),
    "Jon moved this from To do to In progress",
  ],
  [
    "COMPLETED",
    activityLine("COMPLETED", {}, { actor: jon }),
    "Jon completed this",
  ],
  [
    "REOPENED",
    activityLine("REOPENED", {}, { actor: jon }),
    "Jon reopened this",
  ],
  [
    "ASSIGNEE_ADDED",
    activityLine(
      "ASSIGNEE_ADDED",
      { user: sam, isOwner: false },
      { actor: jon },
    ),
    "Jon assigned Sam",
  ],
  [
    "ASSIGNEE_REMOVED",
    activityLine("ASSIGNEE_REMOVED", { user: sam }, { actor: jon }),
    "Jon unassigned Sam",
  ],
  [
    "OWNER_CHANGED",
    activityLine("OWNER_CHANGED", { from: null, to: sam }, { actor: jon }),
    "Jon made Sam the owner",
  ],
  [
    "LABEL_ADDED",
    activityLine(
      "LABEL_ADDED",
      { labelId: "l1", name: "Bug", colour: "RED" },
      { actor: jon },
    ),
    "Jon added the label Bug",
  ],
  [
    "LABEL_REMOVED",
    activityLine(
      "LABEL_REMOVED",
      { labelId: "l1", name: "Bug", colour: "RED" },
      { actor: jon },
    ),
    "Jon removed the label Bug",
  ],
  [
    "SUBTASK_ADDED",
    activityLine(
      "SUBTASK_ADDED",
      { subtask: ref("12.3", "Write tests") },
      { actor: jon },
    ),
    "Jon added the subtask WEB-12.3 Write tests",
  ],
  [
    "SUBTASK_REMOVED",
    activityLine(
      "SUBTASK_REMOVED",
      { subtask: ref("12.3", "Write tests"), deleted: true },
      { actor: jon },
    ),
    "Jon deleted the subtask WEB-12.3 Write tests",
  ],
  [
    "PARENT_CHANGED",
    activityLine(
      "PARENT_CHANGED",
      { from: null, to: ref("15", "Release") },
      { actor: jon },
    ),
    "Jon made this a subtask of WEB-15 Release",
  ],
  [
    "NUMBER_CHANGED",
    activityLine(
      "NUMBER_CHANGED",
      { from: "12.1", to: "15.3" },
      { actor: jon },
    ),
    "Jon changed the number from WEB-12.1 to WEB-15.3",
  ],
  [
    "TIME_LOGGED",
    activityLine(
      "TIME_LOGGED",
      {
        entryId: "e1",
        user: jon,
        fromTimer: true,
        minutes: 90,
        workDate: "2026-11-02",
        note: null,
      },
      { actor: jon },
    ),
    "Jon logged 1h 30m for 2 Nov (timer)",
  ],
  [
    "TIME_ENTRY_EDITED",
    activityLine(
      "TIME_ENTRY_EDITED",
      {
        entryId: "e1",
        user: sam,
        from: { minutes: 60, workDate: "2026-11-02", note: null },
        to: { minutes: 90, workDate: "2026-11-03", note: null },
      },
      { actor: jon },
    ),
    "Jon changed Sam's time from 1h on 2 Nov to 1h 30m on 3 Nov",
  ],
  [
    "TIME_ENTRY_DELETED",
    activityLine(
      "TIME_ENTRY_DELETED",
      {
        entryId: "e1",
        user: sam,
        minutes: 90,
        workDate: "2026-11-02",
        note: null,
      },
      { actor: jon },
    ),
    "Jon deleted Sam's 1h 30m for 2 Nov",
  ],
  [
    "CHECKLIST_ADDED",
    activityLine(
      "CHECKLIST_ADDED",
      { checklistId: "k1", name: "Testing" },
      { actor: jon },
    ),
    "Jon added the checklist 'Testing'",
  ],
  [
    "CHECKLIST_RENAMED",
    activityLine(
      "CHECKLIST_RENAMED",
      { checklistId: "k1", from: "A", to: "B" },
      { actor: jon },
    ),
    "Jon renamed the checklist 'A' to 'B'",
  ],
  [
    "CHECKLIST_DELETED",
    activityLine(
      "CHECKLIST_DELETED",
      { checklistId: "k1", name: "Testing" },
      { actor: jon },
    ),
    "Jon deleted the checklist 'Testing'",
  ],
  [
    "CHECKLIST_ITEM_TO_SUBTASK",
    activityLine(
      "CHECKLIST_ITEM_TO_SUBTASK",
      {
        checklistId: "k1",
        checklistName: "Testing",
        subtask: ref("12.3", "Write tests"),
      },
      { actor: jon },
    ),
    "Jon turned 'Write tests' from Testing into WEB-12.3",
  ],
  // Files on cards, PR A, criterion 33.
  [
    "FILE_ADDED",
    activityLine(
      "FILE_ADDED",
      { fileId: "f1", name: "plan.pdf", size: 12 },
      { actor: jon },
    ),
    "Jon attached the file 'plan.pdf'",
  ],
  [
    "FILE_REMOVED",
    activityLine(
      "FILE_REMOVED",
      { fileId: "f1", name: "plan.pdf", size: 12 },
      { actor: jon },
    ),
    "Jon removed the file 'plan.pdf'",
  ],
  // Criterion 31 (shape of the details pending the repository owner's word).
  [
    "FILE_MOVED",
    activityLine(
      "FILE_MOVED",
      {
        fileId: "f1",
        name: "x",
        size: 12,
        from: { numberPath: "12", title: "Login" },
      },
      { actor: jon },
    ),
    "Jon moved the file 'x' here from WEB-12, which was deleted",
  ],
];

describe("The sentence for a history line", () => {
  // 39
  it("has a test case for every kind", () => {
    expect(everyKindIsListed).toBe(true);
    expect(CASES.map(([kind]) => kind)).toEqual(
      expect.arrayContaining([...ALL_KINDS]),
    );
    expect(new Set(CASES.map(([kind]) => kind)).size).toBe(28);
  });

  // 39
  it.each(CASES)("gives a sentence for %s", (_kind, line, expected) => {
    expect(sentence(line)).toBe(expected);
  });

  // 39: a kind outside the list does not type-check.
  it("only takes the kinds the API records", () => {
    const unknownKind = {
      id: "x",
      kind: "NOT_A_KIND",
      details: {},
      actor: null,
      createdAt: "2026-11-07T07:00:00.000Z",
    };
    // @ts-expect-error a line of an unknown kind is not an ActivityLine
    const line: ActivityLine = unknownKind;
    expect(line).toBeDefined();
  });

  it("never shows a raw value in a sentence", () => {
    for (const [, line] of CASES) {
      expect(sentence(line)).not.toMatch(/undefined|null|\[object|NaN/);
    }
  });
});

// The kinds with a sentence for each way the change can go (agreed words
// where the table gives only the shape).
describe("Sentences that depend on the change", () => {
  it("says when the due date is set, changed or removed (agreed 2026-11-08)", () => {
    const due = (from: string | null, to: string | null, hasTime = true) =>
      activityLine(
        "DUE_DATE_CHANGED",
        { from: { at: from, hasTime }, to: { at: to, hasTime } },
        { actor: jon },
      );
    // A time is shown in the project's time zone, which is named.
    expect(sentence(due(null, "2026-11-04T17:00:00.000Z"))).toBe(
      "Jon set the due date to 4 Nov, 17:00 Europe/London",
    );
    expect(
      sentence(due("2026-11-04T17:00:00.000Z", "2026-11-05T09:30:00.000Z")),
    ).toBe(
      "Jon changed the due date from 4 Nov, 17:00 Europe/London to 5 Nov, 09:30 Europe/London",
    );
    expect(sentence(due("2026-11-04T17:00:00.000Z", null))).toBe(
      "Jon removed the due date",
    );
    // A due date without a time is a day, the same in every zone.
    expect(sentence(due(null, "2026-11-04T00:00:00.000Z", false))).toBe(
      "Jon set the due date to 4 Nov",
    );
  });

  it("shows a due time in the project’s time zone, not the viewer’s (agreed 2026-11-08)", () => {
    const line = activityLine(
      "DUE_DATE_CHANGED",
      {
        from: { at: null, hasTime: false },
        to: { at: "2026-11-04T17:00:00.000Z", hasTime: true },
      },
      { actor: jon },
    );
    expect(activitySentence(line, { ...context, timeZone: "Asia/Tokyo" })).toBe(
      "Jon set the due date to 5 Nov, 02:00 Asia/Tokyo",
    );
  });

  it("says when the estimate is set, changed or removed (agreed 2026-11-08)", () => {
    const estimate = (from: number | null, to: number | null) =>
      activityLine("ESTIMATE_CHANGED", { from, to }, { actor: jon });
    expect(sentence(estimate(null, 45))).toBe("Jon set the estimate to 45m");
    expect(sentence(estimate(45, 120))).toBe(
      "Jon changed the estimate from 45m to 2h",
    );
    expect(sentence(estimate(120, null))).toBe("Jon removed the estimate");
  });

  it("calls no priority “None” (agreed 2026-11-08)", () => {
    const line = activityLine(
      "PRIORITY_CHANGED",
      { from: "NONE", to: "URGENT" },
      { actor: jon },
    );
    expect(sentence(line)).toBe("Jon changed the priority from None to Urgent");
  });

  it("says who is assigned, as owner too", () => {
    const line = activityLine(
      "ASSIGNEE_ADDED",
      { user: sam, isOwner: true },
      { actor: jon },
    );
    expect(sentence(line)).toBe("Jon assigned Sam (as owner)");
  });

  it("says when the owner is removed", () => {
    const line = activityLine(
      "OWNER_CHANGED",
      { from: sam, to: null },
      { actor: jon },
    );
    expect(sentence(line)).toBe("Jon removed the owner");
  });

  it("tells a deleted subtask from one moved to another parent", () => {
    const line = activityLine(
      "SUBTASK_REMOVED",
      { subtask: ref("12.3", "Write tests"), deleted: false },
      { actor: jon },
    );
    expect(sentence(line)).toBe(
      "Jon moved the subtask WEB-12.3 Write tests to another parent",
    );
  });

  it("says how the parent changed", () => {
    const parent = (
      from: ReturnType<typeof ref> | null,
      to: ReturnType<typeof ref> | null,
    ) => activityLine("PARENT_CHANGED", { from, to }, { actor: jon });
    expect(sentence(parent(ref("12", "Login"), ref("15", "Release")))).toBe(
      "Jon moved this from WEB-12 to WEB-15",
    );
    expect(sentence(parent(ref("12", "Login"), null))).toBe(
      "Jon made this its own card",
    );
  });

  it("leaves the “(timer)” off time that was typed in, and names someone else’s time", () => {
    const logged = (user: typeof jon, fromTimer: boolean) =>
      activityLine(
        "TIME_LOGGED",
        {
          entryId: "e1",
          user,
          fromTimer,
          minutes: 90,
          workDate: "2026-11-02",
          note: "Checked",
        },
        { actor: jon },
      );
    expect(sentence(logged(jon, false))).toBe("Jon logged 1h 30m for 2 Nov");
    // The table adds “for Sam” (before the day) when the time is someone else's.
    expect(sentence(logged(sam, false))).toBe(
      "Jon logged 1h 30m for Sam on 2 Nov",
    );
  });

  it("says “their own” when people change or delete their own time (agreed 2026-11-08)", () => {
    const edited = activityLine(
      "TIME_ENTRY_EDITED",
      {
        entryId: "e1",
        user: jon,
        from: { minutes: 60, workDate: "2026-11-02", note: null },
        to: { minutes: 90, workDate: "2026-11-03", note: null },
      },
      { actor: jon },
    );
    expect(sentence(edited)).toBe(
      "Jon changed their own time from 1h on 2 Nov to 1h 30m on 3 Nov",
    );
    const deleted = activityLine(
      "TIME_ENTRY_DELETED",
      {
        entryId: "e1",
        user: jon,
        minutes: 90,
        workDate: "2026-11-02",
        note: null,
      },
      { actor: jon },
    );
    expect(sentence(deleted)).toBe("Jon deleted their own 1h 30m for 2 Nov");
  });

  // The year is shown when it is not this year.
  it("shows the year of a date that is not in the current year", () => {
    const line = activityLine(
      "TIME_LOGGED",
      {
        entryId: "e1",
        user: jon,
        fromTimer: false,
        minutes: 30,
        workDate: "2025-11-02",
        note: null,
      },
      { actor: jon },
    );
    expect(sentence(line)).toBe("Jon logged 30m for 2 Nov 2025");
  });

  it("decides “this year” by the project’s time zone", () => {
    const line = activityLine(
      "TIME_LOGGED",
      {
        entryId: "e1",
        user: jon,
        fromTimer: false,
        minutes: 30,
        workDate: "2026-12-31",
        note: null,
      },
      { actor: jon },
    );
    // 31 Dec 2026, 23:30 UTC is already 2027 in Auckland.
    const newYear = { ...context, now: new Date("2026-12-31T23:30:00.000Z") };
    expect(activitySentence(line, newYear)).toMatch(/for 31 Dec$/);
    expect(
      activitySentence(line, { ...newYear, timeZone: "Pacific/Auckland" }),
    ).toMatch(/for 31 Dec 2026$/);
  });
});

// 41
describe("A line whose person was deleted", () => {
  it("reads “Former member …”", () => {
    const line = activityLine(
      "MOVED",
      {
        from: { columnId: "c1", name: "To do" },
        to: { columnId: "c2", name: "In progress" },
      },
      { actor: null },
    );
    expect(sentence(line)).toBe(
      "Former member moved this from To do to In progress",
    );
  });

  it("works for every kind", () => {
    for (const [, line] of CASES) {
      const orphan = { ...line, actor: null } as ActivityLine;
      expect(sentence(orphan)).toMatch(/^Former member /);
    }
  });
});

// Agreed 2026-11-08: a kind this page does not know (the API is newer than
// the page) does not break the page.
describe("A line of a kind this page does not know (agreed 2026-11-08)", () => {
  function unknownKind(actor: { id: string; displayName: string } | null) {
    return {
      ...activityLine("COMPLETED", {}, { actor }),
      kind: "CARD_ARCHIVED",
    } as unknown as ActivityLine;
  }

  it("reads “<name> made a change this page can’t show yet”", () => {
    expect(activitySentence(unknownKind(jon), context)).toBe(
      "Jon made a change this page can’t show yet",
    );
  });

  it("reads “Former member made a change this page can’t show yet” for a deleted person", () => {
    expect(activitySentence(unknownKind(null), context)).toBe(
      "Former member made a change this page can’t show yet",
    );
  });
});

// Agreed 2026-11-08: a due date in another year shows the year, in the
// project's time zone.
describe("A due date in another year (agreed 2026-11-08)", () => {
  it("shows the year, with the time", () => {
    const line = activityLine(
      "DUE_DATE_CHANGED",
      {
        from: { at: null, hasTime: false },
        to: { at: "2025-11-04T17:00:00.000Z", hasTime: true },
      },
      { actor: jon },
    );
    expect(sentence(line)).toBe(
      "Jon set the due date to 4 Nov 2025, 17:00 Europe/London",
    );
  });

  it("shows the year for a day without a time", () => {
    const line = activityLine(
      "DUE_DATE_CHANGED",
      {
        from: { at: null, hasTime: false },
        to: { at: "2025-11-04T00:00:00.000Z", hasTime: false },
      },
      { actor: jon },
    );
    expect(sentence(line)).toBe("Jon set the due date to 4 Nov 2025");
  });

  it("decides the year in the project’s zone, not the viewer’s", () => {
    // 23:30 UTC on 31 Dec 2026 is 2027 in Auckland.
    const line = activityLine(
      "DUE_DATE_CHANGED",
      {
        from: { at: null, hasTime: false },
        to: { at: "2026-12-31T23:30:00.000Z", hasTime: true },
      },
      { actor: jon },
    );
    expect(
      activitySentence(line, { ...context, timeZone: "Pacific/Auckland" }),
    ).toContain("1 Jan 2027");
  });
});

// Files on cards, PR A, criterion 33.
describe("Sentences about files", () => {
  const details = { fileId: "f1", name: "Résumé 日本 🎉.pdf", size: 12 };

  // 33
  it("keeps the file name exactly, in any language", () => {
    expect(sentence(activityLine("FILE_ADDED", details, { actor: jon }))).toBe(
      "Jon attached the file 'Résumé 日本 🎉.pdf'",
    );
  });

  // 33
  it('says "Former member" for a deleted account', () => {
    expect(sentence(activityLine("FILE_ADDED", details, { actor: null }))).toBe(
      "Former member attached the file 'Résumé 日本 🎉.pdf'",
    );
    expect(
      sentence(activityLine("FILE_REMOVED", details, { actor: null })),
    ).toBe("Former member removed the file 'Résumé 日本 🎉.pdf'");
  });

  // 31
  it("says where a moved file came from, with the name kept exactly", () => {
    const line = activityLine(
      "FILE_MOVED",
      {
        fileId: "f1",
        name: "Résumé 日本 🎉.pdf",
        size: 12,
        from: { numberPath: "12.3", title: "Form" },
      },
      { actor: jon },
    );
    expect(sentence(line)).toBe(
      "Jon moved the file 'Résumé 日本 🎉.pdf' here from WEB-12.3, which was deleted",
    );
  });
});

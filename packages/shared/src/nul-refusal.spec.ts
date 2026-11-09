import { describe, expect, it } from 'vitest';
import {
  activityQuerySchema,
  cardChangesSchema,
  cardSearchQuerySchema,
  changePasswordSchema,
  checklistChangesSchema,
  checklistItemChangesSchema,
  labelChangesSchema,
  newBoardSchema,
  newCardSchema,
  newChatSchema,
  newChecklistItemSchema,
  newChecklistSchema,
  newLabelSchema,
  newMemberSchema,
  newProjectSchema,
  projectChangesSchema,
  newSubtaskSchema,
  newTimeEntrySchema,
  signInSchema,
  signUpSchema,
  suggestCodeQuerySchema,
  timeEntryChangesSchema,
} from './index.js';

// Refusing a NUL character (U+0000) in every text field. PostgreSQL cannot
// store it, so without this rule the API answers 500. Agreed 2026-11-08
// (plan "refuse NUL characters in text fields", Jon's answers 1 to 4).
// The message uses the typographic apostrophe, as CHECKLIST_BLANK_MESSAGE does.
const NUL_MESSAGE = 'This contains a hidden character that can’t be saved';

interface TextField {
  // What the field is, for the test name.
  name: string;
  // Parses a request in which the text field holds `text`.
  parse: (text: string) => {
    success: boolean;
    error?: { issues: { message: string }[] };
  };
}

const fields: TextField[] = [
  {
    name: 'card title (new card)',
    parse: (t) => newCardSchema.safeParse({ title: t }),
  },
  {
    name: 'card description (new card)',
    parse: (t) => newCardSchema.safeParse({ title: 'Login', description: t }),
  },
  {
    name: 'card title (card changes)',
    parse: (t) => cardChangesSchema.safeParse({ title: t }),
  },
  {
    name: 'card description (card changes)',
    parse: (t) => cardChangesSchema.safeParse({ description: t }),
  },
  {
    name: 'subtask title (new subtask)',
    parse: (t) =>
      newSubtaskSchema.safeParse({
        title: t,
        columnId: '6f1c0a5e-3b1d-4d7e-8a53-1f0f6f1f2a10',
      }),
  },
  {
    name: 'subtask description (new subtask)',
    parse: (t) =>
      newSubtaskSchema.safeParse({
        title: 'Form',
        description: t,
        columnId: '6f1c0a5e-3b1d-4d7e-8a53-1f0f6f1f2a10',
      }),
  },
  {
    name: 'card search q',
    parse: (t) => cardSearchQuerySchema.safeParse({ q: t }),
  },
  {
    name: 'checklist name (new checklist)',
    parse: (t) => newChecklistSchema.safeParse({ name: t }),
  },
  {
    name: 'checklist name (checklist changes)',
    parse: (t) => checklistChangesSchema.safeParse({ name: t }),
  },
  {
    name: 'checklist item text (new item)',
    parse: (t) => newChecklistItemSchema.safeParse({ text: t }),
  },
  {
    name: 'checklist item text (item changes)',
    parse: (t) => checklistItemChangesSchema.safeParse({ text: t }),
  },
  {
    name: 'time entry note (new entry)',
    parse: (t) =>
      newTimeEntrySchema.safeParse({
        minutes: 30,
        workDate: '2026-11-02',
        note: t,
      }),
  },
  {
    name: 'time entry note (entry changes)',
    parse: (t) => timeEntryChangesSchema.safeParse({ note: t }),
  },
  {
    name: 'label name (new label)',
    parse: (t) => newLabelSchema.safeParse({ name: t, colour: 'RED' }),
  },
  {
    name: 'label name (label changes)',
    parse: (t) => labelChangesSchema.safeParse({ name: t }),
  },
  {
    name: 'board name',
    parse: (t) => newBoardSchema.safeParse({ name: t }),
  },
  {
    name: 'chat title',
    parse: (t) => newChatSchema.safeParse({ title: t }),
  },
  {
    name: 'project name',
    parse: (t) => newProjectSchema.safeParse({ name: t, code: 'WEB' }),
  },
  {
    name: 'project description',
    parse: (t) =>
      newProjectSchema.safeParse({
        name: 'Website',
        description: t,
        code: 'WEB',
      }),
  },
  {
    name: 'project code',
    parse: (t) => newProjectSchema.safeParse({ name: 'Website', code: t }),
  },
  {
    name: 'suggest-code name',
    parse: (t) => suggestCodeQuerySchema.safeParse({ name: t }),
  },
  {
    name: 'sign-up display name',
    parse: (t) =>
      signUpSchema.safeParse({
        email: 'ana@example.com',
        displayName: t,
        password: 'a long enough password',
      }),
  },
  {
    name: 'activity before',
    parse: (t) => activityQuerySchema.safeParse({ before: t }),
  },
];

// Email fields can't hold a tab or a new line, so they have their own list.
const emailFields: TextField[] = [
  {
    name: 'sign-up email',
    parse: (t) =>
      signUpSchema.safeParse({
        email: t,
        displayName: 'Ana',
        password: 'a long enough password',
      }),
  },
  {
    name: 'member email',
    parse: (t) => newMemberSchema.safeParse({ email: t }),
  },
];

// Fields that must refuse a NUL, so a new password can't hold one.
const newPasswordFields: TextField[] = [
  {
    name: 'sign-up password',
    parse: (t) =>
      signUpSchema.safeParse({
        email: 'ana@example.com',
        displayName: 'Ana',
        password: t,
      }),
  },
  {
    name: 'change-password newPassword',
    parse: (t) =>
      changePasswordSchema.safeParse({
        currentPassword: 'the old password',
        newPassword: t,
      }),
  },
];

function firstMessage(result: ReturnType<TextField['parse']>) {
  return result.error?.issues[0]?.message;
}

// Criterion 1: every listed text field refuses a NUL with the agreed message.
describe('a NUL character in a text field', () => {
  describe.each(fields)('in $name', (field) => {
    it('is refused with the hidden-character message', () => {
      for (const text of ['\u0000', 'before\u0000after', 'at the end\u0000']) {
        const result = field.parse(text);

        expect(result.success).toBe(false);
        expect(firstMessage(result)).toBe(NUL_MESSAGE);
      }
    });
  });

  // Long enough that length is not the first thing refused.
  describe.each(newPasswordFields)('in $name', (field) => {
    it('is refused with the hidden-character message', () => {
      for (const text of [
        'a long enough\u0000password',
        'a long enough password\u0000',
      ]) {
        const result = field.parse(text);

        expect(result.success).toBe(false);
        expect(firstMessage(result)).toBe(NUL_MESSAGE);
      }
    });
  });

  describe.each(emailFields)('in $name', (field) => {
    it('is refused with the hidden-character message', () => {
      const result = field.parse('an\u0000a@example.com');

      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(NUL_MESSAGE);
    });
  });
});

// Criteria 2 and 7: text without a NUL is accepted as before, including tab,
// new line, carriage return and emoji.
describe('text without a NUL character', () => {
  const ordinary = 'a\tb\nc\r\nd 😀 é';

  describe.each(fields.filter((f) => !f.name.includes('code')))(
    'in $name',
    (field) => {
      it('is still accepted, with tab, new line, carriage return and emoji', () => {
        const result = field.parse(ordinary);

        expect(result.success).toBe(true);
      });
    },
  );

  it('is still accepted in a project code', () => {
    const result = newProjectSchema.safeParse({
      name: 'Website',
      code: 'web 😀',
    });

    expect(result.success).toBe(true);
  });

  it.each(emailFields)('is still accepted in $name', (field) => {
    expect(field.parse('ana@example.com').success).toBe(true);
  });

  it.each(newPasswordFields)(
    'is still accepted in $name, with tab, new line and emoji',
    (field) => {
      expect(field.parse('a long\tpass\nphrase 😀').success).toBe(true);
    },
  );
});

// Criterion 6: the passwords you already have are left as they are.
describe('a NUL character in an existing password', () => {
  it('is still accepted when signing in', () => {
    const result = signInSchema.safeParse({
      email: 'ana@example.com',
      password: 'old\u0000password',
    });

    expect(result.success).toBe(true);
  });

  it('is still accepted as the current password when changing it', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'old\u0000password',
      newPassword: 'another long password',
    });

    expect(result.success).toBe(true);
  });
});

// A value that breaks the NUL rule and another rule too gets only the NUL
// message, because the NUL check runs first and stops the others (regression
// guards: these pass as long as textWithoutNul() stays first and aborts).
describe('a value that breaks the NUL rule and another rule', () => {
  const cases: { name: string; parse: TextField['parse']; text: string }[] = [
    {
      name: 'a too-short sign-up password',
      parse: (t) =>
        signUpSchema.safeParse({
          email: 'ana@example.com',
          displayName: 'Ana',
          password: t,
        }),
      text: 'a\u0000',
    },
    {
      name: 'a blank checklist name',
      parse: (t) => newChecklistSchema.safeParse({ name: t }),
      text: ' \u0000 ',
    },
    {
      name: 'a too-long board name',
      parse: (t) => newBoardSchema.safeParse({ name: t }),
      text: 'x'.repeat(150) + '\u0000',
    },
  ];

  it.each(cases)('gets only the NUL message for $name', (c) => {
    const result = c.parse(c.text);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([NUL_MESSAGE]);
  });
});

// Criterion 1: the project time zone refuses a NUL, with the NUL message
// first (not "Unknown time zone").
describe('a NUL character in a project time zone', () => {
  it('is refused with only the hidden-character message', () => {
    const result = projectChangesSchema.safeParse({
      timeZone: 'Europe/Lon\u0000don',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual([NUL_MESSAGE]);
  });

  it('still accepts a known time zone', () => {
    expect(
      projectChangesSchema.safeParse({ timeZone: 'Europe/London' }).success,
    ).toBe(true);
  });
});

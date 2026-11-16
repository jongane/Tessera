import { describe, expect, it } from 'vitest';
import {
  messageBodyRequestSchema,
  MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE,
  MESSAGE_FILES_MAX,
  newMessageSchema,
  screenshotName,
} from './index.js';

// Files on messages, PR B (plan "files on messages, and screenshots in the
// message box"): the shared rules for sending a message with files, the
// message's own collision wording and the pasted-screenshot name.
//
// Contract these tests assume where the plan names a thing but not its shape:
//   MESSAGE_FILES_MAX = 10
//   MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE =
//     'Someone changed this message at the same time. Try again.'
//   newMessageSchema: { body, id?, fileIds? } with fileIds 0 to 10 different
//     UUIDs (default: none); blank body is allowed only with at least one id.
//   messageBodyRequestSchema (the edit body) allows blank text; the API
//     checks it against the message's files.
//   screenshotName(when: Date, extension: string, taken?: readonly string[]):
//     string. `when` is read in the person's own time zone (local getters).
//     "Screenshot 2026-11-16 14.05.png"; when that name is in `taken` (two
//     pasted in the same minute) the seconds are added:
//     "Screenshot 2026-11-16 14.05.07.png". `extension` has no dot ("png").

const ID_1 = '3f2b8c1e-9d4a-4f6b-8a1c-2e7d5b9a0c11';
const ID_2 = '3f2b8c1e-9d4a-4f6b-8a1c-2e7d5b9a0c12';

function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `3f2b8c1e-9d4a-4f6b-8a1c-${String(i).padStart(12, '0')}`,
  );
}

describe('MESSAGE_FILES_MAX', () => {
  // 11
  it('is 10', () => {
    expect(MESSAGE_FILES_MAX).toBe(10);
  });
});

describe('newMessageSchema with files', () => {
  // 10, 11
  it('takes 0 to 10 different file ids', () => {
    expect(newMessageSchema.safeParse({ body: 'Hi' }).success).toBe(true);
    expect(
      newMessageSchema.safeParse({ body: 'Hi', fileIds: [] }).success,
    ).toBe(true);
    const ten = newMessageSchema.safeParse({ body: 'Hi', fileIds: ids(10) });
    expect(ten.success).toBe(true);
    expect(ten.data).toMatchObject({ fileIds: ids(10) });
  });

  // 11
  it('refuses 11 file ids', () => {
    expect(
      newMessageSchema.safeParse({ body: 'Hi', fileIds: ids(11) }).success,
    ).toBe(false);
  });

  // 11
  it('refuses the same file id twice', () => {
    expect(
      newMessageSchema.safeParse({ body: 'Hi', fileIds: [ID_1, ID_1] }).success,
    ).toBe(false);
  });

  // 11
  it('refuses a file id that is not a UUID', () => {
    expect(
      newMessageSchema.safeParse({ body: 'Hi', fileIds: ['abc'] }).success,
    ).toBe(false);
  });

  // 13
  it('allows blank text when there is at least one file', () => {
    for (const blank of ['', ' ', '\n ']) {
      expect(
        newMessageSchema.safeParse({ body: blank, fileIds: [ID_1] }).success,
        `“${blank}”`,
      ).toBe(true);
    }
    expect(
      newMessageSchema.safeParse({ body: '  ', fileIds: [ID_1, ID_2] }).success,
    ).toBe(true);
  });

  // 13
  it('still refuses blank text when there is no file', () => {
    expect(newMessageSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(newMessageSchema.safeParse({ body: '', fileIds: [] }).success).toBe(
      false,
    );
  });

  // 13
  it('trims the text of a message with files, and keeps the other text rules', () => {
    expect(
      newMessageSchema.parse({ body: '  Hi  ', fileIds: [ID_1] }).body,
    ).toBe('Hi');
    expect(
      newMessageSchema.safeParse({ body: 'x'.repeat(10_001), fileIds: [ID_1] })
        .success,
    ).toBe(false);
    expect(
      newMessageSchema.safeParse({ body: 'a\u0000b', fileIds: [ID_1] }).success,
    ).toBe(false);
  });
});

describe('messageBodyRequestSchema (the edit) with files in mind', () => {
  // 21
  it('allows blank text, which the API checks against the message’s files', () => {
    expect(messageBodyRequestSchema.safeParse({ body: '   ' }).success).toBe(
      true,
    );
    expect(messageBodyRequestSchema.parse({ body: '  ' }).body).toBe('');
  });

  // 21
  it('still refuses text over 10,000 characters and a NUL', () => {
    expect(
      messageBodyRequestSchema.safeParse({ body: 'x'.repeat(10_001) }).success,
    ).toBe(false);
    expect(
      messageBodyRequestSchema.safeParse({ body: 'a\u0000' }).success,
    ).toBe(false);
  });
});

describe('the message’s own collision wording', () => {
  // 20
  it('says "Someone changed this message at the same time. Try again."', () => {
    expect(MESSAGE_CHANGED_AT_THE_SAME_TIME_MESSAGE).toBe(
      'Someone changed this message at the same time. Try again.',
    );
  });
});

describe('screenshotName', () => {
  // 27
  it('writes "Screenshot YYYY-MM-DD HH.MM.ext" in the person’s own time', () => {
    const when = new Date(2026, 10, 16, 14, 5, 7);

    expect(screenshotName(when, 'png')).toBe('Screenshot 2026-11-16 14.05.png');
  });

  // 27
  it('pads the month, day, hour and minute to two digits', () => {
    expect(screenshotName(new Date(2026, 0, 3, 4, 9, 30), 'png')).toBe(
      'Screenshot 2026-01-03 04.09.png',
    );
  });

  // 27
  it('uses the image’s real extension', () => {
    const when = new Date(2026, 10, 16, 14, 5, 7);

    expect(screenshotName(when, 'jpg')).toBe('Screenshot 2026-11-16 14.05.jpg');
    expect(screenshotName(when, 'webp')).toBe(
      'Screenshot 2026-11-16 14.05.webp',
    );
  });

  // 27
  it('adds the seconds when the same minute’s name is already taken', () => {
    const when = new Date(2026, 10, 16, 14, 5, 7);

    expect(
      screenshotName(when, 'png', ['Screenshot 2026-11-16 14.05.png']),
    ).toBe('Screenshot 2026-11-16 14.05.07.png');
  });

  // 27
  it('does not add the seconds for a name that is not taken, even in another extension', () => {
    const when = new Date(2026, 10, 16, 14, 5, 7);

    expect(
      screenshotName(when, 'jpg', ['Screenshot 2026-11-16 14.05.png']),
    ).toBe('Screenshot 2026-11-16 14.05.jpg');
  });
});

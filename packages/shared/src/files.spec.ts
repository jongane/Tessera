import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  fileNameSchema,
  formatFileSize,
  NUL_MESSAGE,
} from './index.js';

// Files on cards, PR A (plan "file storage and files on cards"): the rules
// for a file's name, the check of its first bytes, and how a size is written.
// Contract these tests assume (the plan names fileNameSchema and
// detectImageType, and "size formatting used by the web app"):
//   fileNameSchema: a zod schema, parsing text into the stored name
//   detectImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' |
//     'image/gif' | 'image/webp' | null (null: not one of the four)
//   formatFileSize(bytes: number): string
// All three are exported from `@tessera/shared`.

function nameOf(input: string) {
  return fileNameSchema.safeParse(input);
}

function firstMessage(input: string) {
  const result = nameOf(input);
  return result.success ? null : result.error.issues[0]?.message;
}

describe('fileNameSchema', () => {
  // 16
  it.each([
    ['C:\\Users\\jon\\plan.pdf', 'plan.pdf'],
    ['../plan.pdf', 'plan.pdf'],
    ['/etc/passwd', 'passwd'],
    ['a/b\\c/d.txt', 'd.txt'],
    ['plan.pdf', 'plan.pdf'],
  ])('removes the folder part of %j, leaving %j', (input, expected) => {
    const result = nameOf(input);
    expect(result.success && result.data).toBe(expected);
  });

  // 16
  it('drops spaces at both ends and keeps the ones inside', () => {
    const result = nameOf('   my plan  v2.pdf  ');
    expect(result.success && result.data).toBe('my plan  v2.pdf');
  });

  // 16
  it('keeps letters from any language and emoji exactly', () => {
    const name = 'Résumé 日本 🎉.pdf';
    const result = nameOf(name);
    expect(result.success && result.data).toBe(name);
  });

  // 16
  it('refuses a NUL character with the app’s message', () => {
    expect(firstMessage('pl\u0000an.pdf')).toBe(NUL_MESSAGE);
    expect(firstMessage('..\\..\u0000/x.pdf')).toBe(NUL_MESSAGE);
  });

  // 16
  it.each(['', '   ', '../', 'C:\\Users\\jon\\', '/'])(
    'refuses %j as empty, saying "This can’t be empty"',
    (input) => {
      expect(firstMessage(input)).toBe('This can’t be empty');
    },
  );

  // 16
  it('accepts 255 characters and refuses 256, saying "Use at most 255 characters"', () => {
    expect(nameOf('x'.repeat(255)).success).toBe(true);
    expect(firstMessage('x'.repeat(256))).toBe('Use at most 255 characters');
  });

  // 16
  it('counts the name that is left after the folder part is removed', () => {
    expect(nameOf(`some/folder/${'x'.repeat(255)}`).success).toBe(true);
    expect(firstMessage(`some/folder/${'x'.repeat(256)}`)).toBe(
      'Use at most 255 characters',
    );
  });
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF87 = Array.from(Buffer.from('GIF87a'));
const GIF89 = Array.from(Buffer.from('GIF89a'));
// "RIFF", four size bytes, "WEBP".
const WEBP = [
  ...Array.from(Buffer.from('RIFF')),
  0x24,
  0x00,
  0x00,
  0x00,
  ...Array.from(Buffer.from('WEBP')),
];
const text = (s: string) => new TextEncoder().encode(s);

describe('detectImageType', () => {
  // 17
  it.each([
    ['a PNG', PNG, 'image/png'],
    ['a JPEG', JPEG, 'image/jpeg'],
    ['a GIF87a', GIF87, 'image/gif'],
    ['a GIF89a', GIF89, 'image/gif'],
    ['a WebP', WEBP, 'image/webp'],
  ])('knows %s by its first bytes', (_name, bytes, type) => {
    expect(detectImageType(new Uint8Array([...bytes, 1, 2, 3, 4, 5]))).toBe(
      type,
    );
  });

  // 17
  it.each([
    ['an SVG', text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['an HTML file', text('<!doctype html><script>alert(1)</script>')],
    ['plain text', text('hello, I am really a text file')],
    ['an empty file', new Uint8Array()],
    ['a PNG cut short', new Uint8Array(PNG.slice(0, 5))],
    ['a JPEG cut short', new Uint8Array(JPEG.slice(0, 2))],
    [
      'a RIFF that is not WebP',
      new Uint8Array([...WEBP.slice(0, 8), 0x57, 0x41, 0x56, 0x45]),
    ],
    ['a PDF', text('%PDF-1.7')],
  ])('says null for %s', (_name, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });

  // 17
  it('looks at the first bytes only: a GIF signature then HTML counts as a GIF, HTML then a signature does not', () => {
    const polyglot = new Uint8Array([...GIF89, ...text('<script>1</script>')]);
    expect(detectImageType(polyglot)).toBe('image/gif');
    expect(detectImageType(text('<html>GIF89a'))).toBeNull();
  });
});

describe('formatFileSize', () => {
  // 35
  it.each([
    [0, '0 bytes'],
    [12, '12 bytes'],
    [1024, '1 KB'],
    [340 * 1024, '340 KB'],
    [Math.round(2.4 * 1024 * 1024), '2.4 MB'],
  ])('writes %i as %j, using 1024 like Windows', (bytes, written) => {
    expect(formatFileSize(bytes)).toBe(written);
  });
});

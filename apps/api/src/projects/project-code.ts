// Project codes are the capitals that start card numbers: WEB in WEB-12.
// The rules here match the migration that gave existing projects their
// codes (prisma/migrations/*_add_project_codes_and_card_numbers).

const PROJECT_CODE_PATTERN = /^[A-Z]{2,6}$/;
const MAX_CODE_LENGTH = 6;
const MAX_INITIALS = 4;
const FALLBACK_CODE = 'PRJ';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Codes that clash with the web app's own addresses. Addresses ignore letter
// case, so a project called ADMIN could never be opened at /ADMIN: it would
// open the server settings at /admin instead.
const RESERVED_CODES = new Set(['ADMIN']);

// Trims and capitalises a code someone typed. Null when it is not 2 to 6
// letters A to Z.
export function normaliseProjectCode(code: string): string | null {
  const normalised = code.trim().toUpperCase();
  return PROJECT_CODE_PATTERN.test(normalised) ? normalised : null;
}

// True for a code no project may use. `code` must already be normalised.
export function isReservedProjectCode(code: string): boolean {
  return RESERVED_CODES.has(code);
}

// A code made from a project's name: the initials of its words (up to 4),
// or for a one-word name its first 3 letters. Only letters A to Z count.
export function suggestProjectCode(name: string): string {
  const words = name.split(/[^A-Za-z]+/).filter((word) => word !== '');
  const initials = words
    .map((word) => word[0])
    .join('')
    .slice(0, MAX_INITIALS);
  if (initials.length >= 2) {
    return initials.toUpperCase();
  }
  const firstLetters = words.join('').slice(0, 3);
  return firstLetters.length >= 2 ? firstLetters.toUpperCase() : FALLBACK_CODE;
}

// Codes to try, in order, when `code` may already be taken:
// WEB, WEBA ... WEBZ, then WEBBA, WEBBB ... (two added letters).
export function* codeCandidates(code: string): Generator<string> {
  yield code;
  for (let attempt = 0; attempt < LETTERS.length ** 2; attempt++) {
    if (attempt < LETTERS.length) {
      yield code.slice(0, MAX_CODE_LENGTH - 1) + LETTERS[attempt];
    } else {
      yield code.slice(0, MAX_CODE_LENGTH - 2) +
        LETTERS[Math.floor(attempt / LETTERS.length) % LETTERS.length] +
        LETTERS[attempt % LETTERS.length];
    }
  }
}

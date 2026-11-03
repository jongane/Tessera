// Card numbers are a project code and a number path: WEB-12, or WEB-12.1.2
// for a subtask. The path is stored on the card; the code is the project's.

const NUMBER_PATH = '[1-9][0-9]*(?:\\.[1-9][0-9]*)*';
const NUMBER_PATH_PATTERN = new RegExp(`^${NUMBER_PATH}$`);
const CARD_REFERENCE_PATTERN = new RegExp(`^([A-Z]{2,6})-(${NUMBER_PATH})$`);

export interface CardReference {
  code: string;
  numberPath: string;
}

export function formatCardNumber(code: string, numberPath: string): string {
  return `${code}-${numberPath}`;
}

// Reads a card number someone typed, such as "web-12". Null when it is not
// a card number.
export function parseCardReference(reference: string): CardReference | null {
  const match = CARD_REFERENCE_PATTERN.exec(reference.trim().toUpperCase());
  if (!match) {
    return null;
  }
  return { code: match[1]!, numberPath: match[2]! };
}

// True for a number path on its own, such as "12" or "12.1".
export function isNumberPath(text: string): boolean {
  return NUMBER_PATH_PATTERN.test(text.trim());
}

// Number order, part by part, so 1.2 comes before 1.10 and 1.1.1 comes
// right after 1.1.
export function byNumber(
  a: { numberPath: string },
  b: { numberPath: string },
): number {
  const left = a.numberPath.split('.').map(Number);
  const right = b.numberPath.split('.').map(Number);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return left[i]! - right[i]!;
    }
  }
  return left.length - right.length;
}

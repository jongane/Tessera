// Card numbers are a project code and a number path: WEB-12, or WEB-12.1.2
// for a subtask. The path is stored on the card; the code is the project's.

const CARD_REFERENCE_PATTERN = /^([A-Z]{2,6})-([1-9][0-9]*(?:\.[1-9][0-9]*)*)$/;

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

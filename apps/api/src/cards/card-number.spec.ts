import {
  formatCardNumber,
  isNumberPath,
  parseCardReference,
} from './card-number.js';

describe('formatCardNumber', () => {
  it('joins the project code and the number', () => {
    expect(formatCardNumber('WEB', '12')).toBe('WEB-12');
    expect(formatCardNumber('WEB', '12.1.2')).toBe('WEB-12.1.2');
  });
});

describe('parseCardReference', () => {
  it.each([
    ['WEB-12', { code: 'WEB', numberPath: '12' }],
    ['web-12.1.2', { code: 'WEB', numberPath: '12.1.2' }],
    [' WEB-7 ', { code: 'WEB', numberPath: '7' }],
  ])('reads "%s"', (reference, expected) => {
    expect(parseCardReference(reference)).toEqual(expected);
  });

  it.each(['WEB', 'WEB-', 'WEB-0', 'WEB-1.', 'W-1', 'WEB 12', '12', ''])(
    'returns null for "%s"',
    (reference) => {
      expect(parseCardReference(reference)).toBeNull();
    },
  );
});

describe('isNumberPath', () => {
  it('accepts a number path on its own', () => {
    expect(isNumberPath('12')).toBe(true);
    expect(isNumberPath(' 12.1.3 ')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const text of ['0', '12.', '1.02', 'WEB-12', '12a', '']) {
      expect(isNumberPath(text)).toBe(false);
    }
  });
});

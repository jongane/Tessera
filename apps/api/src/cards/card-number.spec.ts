import { formatCardNumber, parseCardReference } from './card-number.js';

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

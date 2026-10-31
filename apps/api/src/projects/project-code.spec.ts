import {
  codeCandidates,
  isReservedProjectCode,
  normaliseProjectCode,
  suggestProjectCode,
} from './project-code.js';

describe('suggestProjectCode', () => {
  it.each([
    ['Website', 'WEB'],
    ['Mobile app', 'MA'],
    ['Customer support portal', 'CSP'],
    ['The big new customer portal', 'TBNC'],
    ['web-shop 2', 'WS'],
    ['X', 'PRJ'],
    ['123', 'PRJ'],
  ])('suggests a code for "%s"', (name, code) => {
    expect(suggestProjectCode(name)).toBe(code);
  });
});

describe('codeCandidates', () => {
  it('starts with the code itself, then adds letters', () => {
    const candidates = [...codeCandidates('WEB')];

    expect(candidates.slice(0, 3)).toEqual(['WEB', 'WEBA', 'WEBB']);
    expect(candidates[27]).toBe('WEBBA');
  });

  it('keeps every candidate to 6 letters', () => {
    const candidates = [...codeCandidates('ABCDEF')];

    expect(candidates.slice(0, 2)).toEqual(['ABCDEF', 'ABCDEA']);
    expect(candidates.every((c) => /^[A-Z]{2,6}$/.test(c))).toBe(true);
  });
});

describe('normaliseProjectCode', () => {
  it('trims and capitalises a valid code', () => {
    expect(normaliseProjectCode(' web ')).toBe('WEB');
  });

  it.each(['W', 'WEBSITE', 'WEB1', 'WE B', '', 'WÉB'])(
    'returns null for "%s"',
    (code) => {
      expect(normaliseProjectCode(code)).toBeNull();
    },
  );
});

describe('isReservedProjectCode', () => {
  // /admin is the server settings address, and addresses ignore letter
  // case, so a project called ADMIN could never be opened at /ADMIN.
  it('reserves ADMIN', () => {
    expect(isReservedProjectCode('ADMIN')).toBe(true);
  });

  it('allows other codes', () => {
    expect(isReservedProjectCode('ADM')).toBe(false);
    expect(isReservedProjectCode('WEB')).toBe(false);
  });
});

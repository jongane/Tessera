import { LABEL_COLOURS } from '@tessera/shared';
import { LabelColour } from '../generated/prisma/enums.js';

// The shared input rules list the label colours separately from the
// database, so the web app doesn't need the database code. This keeps the
// two lists the same.
describe('label colours', () => {
  it('match the colours the database allows', () => {
    expect([...LABEL_COLOURS].sort()).toEqual(
      Object.values(LabelColour).sort(),
    );
  });
});

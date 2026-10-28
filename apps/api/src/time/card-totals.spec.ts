import { rollUp, type TreeTimes } from './card-totals.js';

// A tree written as [id, parentId, own estimate, own logged minutes].
function tree(...rows: [string, string | null, number | null, number][]) {
  return rows.map(
    ([id, parentId, estimateMinutes, loggedMinutes]): TreeTimes => ({
      id,
      parentId,
      estimateMinutes,
      loggedMinutes,
    }),
  );
}

describe('rollUp', () => {
  it('uses the card’s own figures when it has no subtasks', () => {
    expect(rollUp(tree(['a', null, 120, 30]), 'a')).toEqual({
      estimateMinutes: 120,
      originalEstimateMinutes: null,
      timeSpentMinutes: 30,
      ownTimeMinutes: 30,
    });
  });

  it('replaces a parent’s estimate with the sum of its subtasks, at every level', () => {
    const cards = tree(
      ['a', null, 600, 0],
      ['b', 'a', 60, 0],
      ['c', 'a', 999, 0],
      ['d', 'c', 30, 0],
      ['e', 'c', 45, 0],
    );

    expect(rollUp(cards, 'a')).toMatchObject({
      estimateMinutes: 60 + 30 + 45,
      originalEstimateMinutes: 600,
    });
    expect(rollUp(cards, 'c')).toMatchObject({
      estimateMinutes: 75,
      originalEstimateMinutes: 999,
    });
  });

  it('adds time logged on the parent itself to all its subtasks’ time', () => {
    const cards = tree(
      ['a', null, null, 15],
      ['b', 'a', null, 20],
      ['c', 'b', null, 40],
    );

    expect(rollUp(cards, 'a')).toMatchObject({
      timeSpentMinutes: 75,
      ownTimeMinutes: 15,
    });
  });

  it('has no estimate when nothing in the tree has one', () => {
    const cards = tree(['a', null, null, 0], ['b', 'a', null, 0]);

    expect(rollUp(cards, 'a')).toMatchObject({
      estimateMinutes: null,
      originalEstimateMinutes: null,
    });
  });

  it('skips subtasks without an estimate in the sum', () => {
    const cards = tree(
      ['a', null, null, 0],
      ['b', 'a', 50, 0],
      ['c', 'a', null, 0],
    );

    expect(rollUp(cards, 'a').estimateMinutes).toBe(50);
  });
});

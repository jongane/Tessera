import { BadRequestException } from '@nestjs/common';
import { reorder } from './reorder.js';

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('reorder', () => {
  it('moves an item up, numbering everything from 0', () => {
    expect(reorder(rows, 'c', 0)).toEqual([
      [0, 'c'],
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('moves an item down', () => {
    expect(reorder(rows, 'a', 1)).toEqual([
      [0, 'b'],
      [1, 'a'],
      [2, 'c'],
    ]);
  });

  it('puts an item last when the index is past the end', () => {
    expect(reorder(rows, 'a', 99)).toEqual([
      [0, 'b'],
      [1, 'c'],
      [2, 'a'],
    ]);
  });

  it('adds an item that was not in the list yet', () => {
    expect(reorder(rows, 'new', 1)).toEqual([
      [0, 'a'],
      [1, 'new'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('refuses a negative index', () => {
    expect(() => reorder(rows, 'a', -1)).toThrow(BadRequestException);
  });
});

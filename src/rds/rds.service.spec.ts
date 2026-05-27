import { batches } from 'src/rds/rds.service';

describe('batches', () => {
  it('splits items into chunks of the given size', () => {
    expect([...batches([1, 2, 3, 4, 5], 2)]).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('yields a single chunk when size exceeds length', () => {
    expect([...batches([1, 2], 10)]).toEqual([[1, 2]]);
  });

  it('yields nothing for an empty input', () => {
    expect([...batches([], 3)]).toEqual([]);
  });

  it('throws when size is not greater than 0', () => {
    expect(() => [...batches([1], 0)]).toThrow(
      'Batch size must be greater than 0',
    );
  });
});

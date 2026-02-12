import { calculateRefundsByUser } from '../refunds';

describe('calculateRefundsByUser', () => {
  test('refunds full buy-only amounts', () => {
    const refunds = calculateRefundsByUser([
      { userId: 'u1', amount: 40 },
      { userId: 'u2', amount: 20 }
    ]);

    expect(refunds).toEqual({ u1: 40, u2: 20 });
  });

  test('handles partial exits with buy and sell', () => {
    const refunds = calculateRefundsByUser([
      { userId: 'u1', amount: 100 },
      { userId: 'u1', amount: -35 },
      { userId: 'u1', amount: 10 }
    ]);

    expect(refunds).toEqual({ u1: 75 });
  });

  test('does not refund fully exited positions', () => {
    const refunds = calculateRefundsByUser([
      { userId: 'u1', amount: 30 },
      { userId: 'u1', amount: -30 }
    ]);

    expect(refunds).toEqual({});
  });

  test('supports multiple users and ignores negative net', () => {
    const refunds = calculateRefundsByUser([
      { userId: 'u1', amount: 50 },
      { userId: 'u1', amount: -10 },
      { userId: 'u2', amount: 25 },
      { userId: 'u2', amount: -30 },
      { userId: 'u3', amount: 15 }
    ]);

    expect(refunds).toEqual({ u1: 40, u3: 15 });
  });
});

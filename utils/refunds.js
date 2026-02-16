import { round2 } from './round';
export { round2 };

export function calculateRefundsByUser(bets) {
  const netByUser = {};

  bets.forEach((bet) => {
    if (!bet?.userId) return;
    const amount = Number(bet.amount || 0);
    if (!netByUser[bet.userId]) {
      netByUser[bet.userId] = 0;
    }
    netByUser[bet.userId] = round2(netByUser[bet.userId] + amount);
  });

  const refunds = {};
  Object.entries(netByUser).forEach(([userId, net]) => {
    if (net > 0) {
      refunds[userId] = round2(net);
    }
  });

  return refunds;
}

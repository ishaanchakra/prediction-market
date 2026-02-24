import { getPrice, calculateBet, calculateSell } from '../lmsr';

/** Seed a market to a given probability using the logit formula */
function seededPool(prob, b = 100) {
  return { yes: b * Math.log(prob / (1 - prob)), no: 0 };
}

describe('LMSR Bug Reproduction & Verification', () => {
  test('REPRO: Should be able to sell YES shares in a market seeded at 10% YES', () => {
    const b = 100;
    const initialProb = 0.1;
    const pool = seededPool(initialProb, b);
    
    // In a 10% YES market, qYes is negative (~ -219.7)
    expect(pool.yes).toBeLessThan(0);
    expect(getPrice(pool)).toBeCloseTo(initialProb, 2);

    // User buys some shares first
    const betAmount = 20;
    const buyResult = calculateBet(pool, betAmount, 'YES', b);
    
    expect(buyResult.shares).toBeGreaterThan(0);
    expect(buyResult.newProbability).toBeGreaterThan(initialProb);

    // User tries to sell ALL shares back
    // BEFORE FIX: safeSharesToSell would be clamped to Math.max(0, qYes).
    // If qYes is negative, safeSharesToSell would be 0, and payout would be 0.
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares, 'YES', b);
    
    expect(sellResult.payout).toBeGreaterThan(0);
    expect(sellResult.payout).toBeCloseTo(betAmount, 0); // Round trip should be close to original bet
    expect(sellResult.newProbability).toBeCloseTo(initialProb, 2);
  });

  test('REPRO: Should be able to sell NO shares in a market seeded at 90% YES', () => {
    const b = 100;
    const initialProb = 0.9; // 10% NO
    const pool = { yes: 0, no: b * Math.log((1-initialProb) / initialProb) };
    
    // In a 90% YES market, if we seed via qNo, qNo is negative (~ -219.7)
    expect(pool.no).toBeLessThan(0);
    expect(getPrice(pool)).toBeCloseTo(initialProb, 2);

    // User buys NO shares
    const betAmount = 20;
    const buyResult = calculateBet(pool, betAmount, 'NO', b);
    
    expect(buyResult.shares).toBeGreaterThan(0);
    expect(buyResult.newProbability).toBeLessThan(initialProb);

    // User tries to sell back
    const sellResult = calculateSell(buyResult.newPool, buyResult.shares, 'NO', b);
    
    expect(sellResult.payout).toBeGreaterThan(0);
    expect(sellResult.payout).toBeCloseTo(betAmount, 0);
    expect(sellResult.newProbability).toBeCloseTo(initialProb, 2);
  });

  test('EDGE CASE: Selling more than qYes when qYes is positive is fine', () => {
    const pool = { yes: 100, no: 0 }; // Prob > 50%
    const sharesToSell = 150; // User claims to have 150 shares
    
    // Logic should allow this (payout will be calculated based on cost difference)
    // In practice, the caller (Cloud Function) verifies the user has the shares.
    const result = calculateSell(pool, sharesToSell, 'YES', 100);
    expect(result.payout).toBeGreaterThan(0);
    expect(result.newPool.yes).toBe(-50); // Pool parameter goes negative
    expect(result.newProbability).toBeLessThan(0.5); 
  });
});

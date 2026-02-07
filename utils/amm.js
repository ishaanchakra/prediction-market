// Utility function for rounding to 2 decimals
function round2(num) {
  return Math.round(num * 100) / 100;
}

// Constant Product AMM (x * y = k)
export function calculateBet(liquidityPool, betAmount, side) {
  let { yes: yesPool = 0, no: noPool = 0 } = liquidityPool;
  
  // Round inputs
  yesPool = round2(yesPool);
  noPool = round2(noPool);
  betAmount = round2(betAmount);
  
  // Handle edge case: if one pool is zero, the constant product formula breaks (k = 0)
  // We need to initialize the zero pool to enable AMM calculations
  
  // Special case: both pools are zero
  if (yesPool === 0 && noPool === 0) {
    const newYesPool = round2(betAmount);
    const newNoPool = round2(betAmount);
    return {
      shares: round2(betAmount),
      newProbability: round2(0.5 * 100) / 100,
      newPool: { yes: newYesPool, no: newNoPool }
    };
  }
  
  // Special case: YES pool is zero
  if (yesPool === 0 && noPool > 0) {
    if (side === 'YES') {
      const newYesPool = round2(betAmount);
      const newNoPool = round2(Math.max(0, noPool - betAmount));
      const totalPool = newYesPool + newNoPool;
      const newProbability = totalPool > 0 ? round2((newYesPool / totalPool) * 100) / 100 : 0.5;
      
      return {
        shares: round2(betAmount),
        newProbability: Math.max(0, Math.min(1, newProbability)),
        newPool: { yes: newYesPool, no: newNoPool }
      };
    } else {
      yesPool = 1;
    }
  }
  
  // Special case: NO pool is zero
  if (noPool === 0 && yesPool > 0) {
    if (side === 'NO') {
      const newNoPool = round2(betAmount);
      const newYesPool = round2(Math.max(0, yesPool - betAmount));
      const totalPool = newYesPool + newNoPool;
      const newProbability = totalPool > 0 ? round2((newYesPool / totalPool) * 100) / 100 : 0.5;
      
      return {
        shares: round2(betAmount),
        newProbability: Math.max(0, Math.min(1, newProbability)),
        newPool: { yes: newYesPool, no: newNoPool }
      };
    } else {
      noPool = 1;
    }
  }
  
  // Normal AMM calculation (both pools are non-zero)
  const k = round2(yesPool * noPool); // constant product
  
  if (side === 'YES') {
    const newYesPool = round2(yesPool + betAmount);
    const newNoPool = round2(k / newYesPool);
    const sharesReceived = round2(noPool - newNoPool);
    const totalPool = round2(newYesPool + newNoPool);
    const newProbability = totalPool > 0 ? round2((newYesPool / totalPool) * 100) / 100 : 0.5;
    
    // Validate results
    if (isNaN(sharesReceived) || isNaN(newProbability) || isNaN(newNoPool)) {
      throw new Error('Invalid calculation: NaN result');
    }
    
    return {
      shares: Math.max(0, round2(sharesReceived)),
      newProbability: Math.max(0, Math.min(1, newProbability)),
      newPool: { yes: newYesPool, no: Math.max(0, newNoPool) }
    };
  } else {
    const newNoPool = round2(noPool + betAmount);
    const newYesPool = round2(k / newNoPool);
    const sharesReceived = round2(yesPool - newYesPool);
    const totalPool = round2(newYesPool + newNoPool);
    const newProbability = totalPool > 0 ? round2((newYesPool / totalPool) * 100) / 100 : 0.5;
    
    // Validate results
    if (isNaN(sharesReceived) || isNaN(newProbability) || isNaN(newYesPool)) {
      throw new Error('Invalid calculation: NaN result');
    }
    
    return {
      shares: Math.max(0, round2(sharesReceived)),
      newProbability: Math.max(0, Math.min(1, newProbability)),
      newPool: { yes: Math.max(0, newYesPool), no: newNoPool }
    };
  }
}
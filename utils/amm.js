// Constant Product AMM (x * y = k)
export function calculateBet(liquidityPool, betAmount, side) {
  let { yes: yesPool = 0, no: noPool = 0 } = liquidityPool;
  
  // Handle edge case: if one pool is zero, the constant product formula breaks (k = 0)
  // We need to initialize the zero pool to enable AMM calculations
  
  // Special case: both pools are zero
  if (yesPool === 0 && noPool === 0) {
    // Initialize both pools with the bet amount (equal probability)
    const newYesPool = side === 'YES' ? betAmount : betAmount;
    const newNoPool = side === 'NO' ? betAmount : betAmount;
    return {
      shares: betAmount, // First bet gets shares equal to bet amount
      newProbability: 0.5,
      newPool: { yes: newYesPool, no: newNoPool }
    };
  }
  
  // Special case: YES pool is zero
  if (yesPool === 0 && noPool > 0) {
    if (side === 'YES') {
      // Betting YES when YES pool is 0 - initialize YES pool
      // Use a simple formula: new YES pool = betAmount, adjust NO pool proportionally
      const newYesPool = betAmount;
      // Maintain reasonable probability - if NO was 100%, reduce it proportionally
      // Keep NO pool large but reduce it to create YES shares
      const newNoPool = noPool - betAmount; // Simple approach: reduce NO by bet amount
      const totalPool = newYesPool + newNoPool;
      const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
      
      return {
        shares: betAmount, // Get shares equal to bet amount
        newProbability: Math.max(0, Math.min(1, newProbability)),
        newPool: { yes: newYesPool, no: Math.max(0, newNoPool) }
      };
    } else {
      // Betting NO when YES is 0 - use minimal YES pool for calculation
      yesPool = 1;
    }
  }
  
  // Special case: NO pool is zero
  if (noPool === 0 && yesPool > 0) {
    if (side === 'NO') {
      // Betting NO when NO pool is 0 - initialize NO pool
      const newNoPool = betAmount;
      const newYesPool = yesPool - betAmount; // Simple approach: reduce YES by bet amount
      const totalPool = newYesPool + newNoPool;
      const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
      
      return {
        shares: betAmount, // Get shares equal to bet amount
        newProbability: Math.max(0, Math.min(1, newProbability)),
        newPool: { yes: Math.max(0, newYesPool), no: newNoPool }
      };
    } else {
      // Betting YES when NO is 0 - use minimal NO pool for calculation
      noPool = 1;
    }
  }
  
  // Normal AMM calculation (both pools are non-zero)
  const k = yesPool * noPool; // constant product
  
  if (side === 'YES') {
    const newYesPool = yesPool + betAmount;
    const newNoPool = k / newYesPool;
    const sharesReceived = noPool - newNoPool;
    const totalPool = newYesPool + newNoPool;
    const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
    
    // Validate results
    if (isNaN(sharesReceived) || isNaN(newProbability) || isNaN(newNoPool)) {
      throw new Error('Invalid calculation: NaN result');
    }
    
    return {
      shares: Math.max(0, sharesReceived),
      newProbability: Math.max(0, Math.min(1, newProbability)),
      newPool: { yes: newYesPool, no: Math.max(0, newNoPool) }
    };
  } else {
    const newNoPool = noPool + betAmount;
    const newYesPool = k / newNoPool;
    const sharesReceived = yesPool - newYesPool;
    const totalPool = newYesPool + newNoPool;
    const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
    
    // Validate results
    if (isNaN(sharesReceived) || isNaN(newProbability) || isNaN(newYesPool)) {
      throw new Error('Invalid calculation: NaN result');
    }
    
    return {
      shares: Math.max(0, sharesReceived),
      newProbability: Math.max(0, Math.min(1, newProbability)),
      newPool: { yes: Math.max(0, newYesPool), no: newNoPool }
    };
  }
}

// NEW FUNCTION: Calculate selling shares back to the pool
export function calculateSell(liquidityPool, sharesToSell, side) {
const { yes: yesPool, no: noPool } = liquidityPool;
const k = yesPool * noPool; // constant product

if (side === 'YES') {
  // User is selling YES shares - add them back to the YES pool
  const newYesPool = yesPool + sharesToSell;
  const newNoPool = k / newYesPool;
  const payout = noPool - newNoPool; // How much rep the user gets back
  const totalPool = newYesPool + newNoPool;
  const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
  
  return {
    payout: Math.max(0, payout),
    newPool: { yes: newYesPool, no: Math.max(0, newNoPool) },
    newProbability: Math.max(0, Math.min(1, newProbability))
  };
} else {
  // User is selling NO shares - add them back to the NO pool
  const newNoPool = noPool + sharesToSell;
  const newYesPool = k / newNoPool;
  const payout = yesPool - newYesPool; // How much rep the user gets back
  const totalPool = newYesPool + newNoPool;
  const newProbability = totalPool > 0 ? newYesPool / totalPool : 0.5;
  
  return {
    payout: Math.max(0, payout),
    newPool: { yes: Math.max(0, newYesPool), no: newNoPool },
    newProbability: Math.max(0, Math.min(1, newProbability))
  };
}
}
// Constant Product AMM (x * y = k)
export function calculateBet(liquidityPool, betAmount, side) {
    const { yes: yesPool, no: noPool } = liquidityPool;
    const k = yesPool * noPool; // constant product
    
    if (side === 'YES') {
      const newYesPool = yesPool + betAmount;
      const newNoPool = k / newYesPool;
      const sharesReceived = noPool - newNoPool; // Fixed: this is how many NO shares decrease
      const newProbability = newYesPool / (newYesPool + newNoPool);
      
      return {
        shares: sharesReceived,
        newProbability,
        newPool: { yes: newYesPool, no: newNoPool }
      };
    } else {
      const newNoPool = noPool + betAmount;
      const newYesPool = k / newNoPool;
      const sharesReceived = yesPool - newYesPool; // Fixed: this is how many YES shares decrease
      const newProbability = newYesPool / (newYesPool + newNoPool);
      
      return {
        shares: sharesReceived,
        newProbability,
        newPool: { yes: newYesPool, no: newNoPool }
      };
    }
  }
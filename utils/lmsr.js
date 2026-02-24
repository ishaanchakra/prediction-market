// Logarithmic Market Scoring Rule (LMSR)
// Cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
// Price of YES: p = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))

const DEFAULT_B = 100;

function cost(qYes, qNo, b = DEFAULT_B) {
  // Use log-sum-exp trick for numerical stability:
  // b * ln(e^(qYes/b) + e^(qNo/b))
  // = b * (max + ln(e^((qYes-max)/b) + e^((qNo-max)/b)))
  const max = Math.max(qYes, qNo);
  return b * (max / b + Math.log(Math.exp((qYes - max) / b) + Math.exp((qNo - max) / b)));
}

function price(qYes, qNo, b = DEFAULT_B) {
  // Softmax for numerical stability
  const max = Math.max(qYes, qNo);
  const expYes = Math.exp((qYes - max) / b);
  const expNo = Math.exp((qNo - max) / b);
  return expYes / (expYes + expNo);
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function normalizePool(outstandingShares) {
  const { yes = 0, no = 0 } = outstandingShares || {};
  assertFiniteNumber(yes, 'yes');
  assertFiniteNumber(no, 'no');
  return { yes, no };
}

function assertPositiveB(b) {
  assertFiniteNumber(b, 'b');
  if (b <= 0) throw new Error('b must be positive');
}

export function calculateBet(outstandingShares, betAmount, side, b = DEFAULT_B) {
  const { yes: qYes, no: qNo } = normalizePool(outstandingShares);
  assertPositiveB(b);
  assertFiniteNumber(betAmount, 'betAmount');
  if (betAmount <= 0) throw new Error('betAmount must be positive');

  const currentCost = cost(qYes, qNo, b);
  const currentPrice = price(qYes, qNo, b);

  // Binary search for how many shares the user gets for betAmount
  // Cost to buy n shares of YES = C(qYes + n, qNo) - C(qYes, qNo)
  let lo = 0;
  const minPrice = Math.max(0.001, Math.min(currentPrice, 1 - currentPrice));
  let hi = (betAmount / minPrice) * 2;
  let shares = 0;

  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    let newCost;
    if (side === 'YES') {
      newCost = cost(qYes + mid, qNo, b) - currentCost;
    } else {
      newCost = cost(qYes, qNo + mid, b) - currentCost;
    }

    if (Math.abs(newCost - betAmount) < 0.0001) {
      shares = mid;
      break;
    }
    if (newCost < betAmount) {
      lo = mid;
    } else {
      hi = mid;
    }
    shares = mid;
  }

  const convergedCost =
    side === 'YES' ? cost(qYes + shares, qNo, b) - currentCost : cost(qYes, qNo + shares, b) - currentCost;
  if (Math.abs(convergedCost - betAmount) > 0.01) {
    throw new Error('LMSR binary search failed to converge');
  }

  const newQYes = side === 'YES' ? qYes + shares : qYes;
  const newQNo = side === 'NO' ? qNo + shares : qNo;
  const newProbability = price(newQYes, newQNo, b);

  if (isNaN(shares) || isNaN(newProbability)) {
    throw new Error('Invalid calculation: NaN result');
  }

  return {
    shares: Math.max(0, shares),
    newProbability: Math.max(0, Math.min(1, newProbability)),
    newPool: { yes: newQYes, no: newQNo }
  };
}

export function calculateSell(outstandingShares, sharesToSell, side, b = DEFAULT_B) {
  const { yes: qYes, no: qNo } = normalizePool(outstandingShares);
  assertPositiveB(b);
  assertFiniteNumber(sharesToSell, 'sharesToSell');
  if (sharesToSell <= 0) {
    return { payout: 0, newPool: { yes: qYes, no: qNo }, newProbability: price(qYes, qNo, b) };
  }
  let safeSharesToSell = sharesToSell;
  if (side === 'YES') {
    safeSharesToSell = sharesToSell;
  }
  if (side === 'NO') {
    safeSharesToSell = sharesToSell;
  }

  const currentCost = cost(qYes, qNo, b);

  let newCost;
  if (side === 'YES') {
    newCost = cost(qYes - safeSharesToSell, qNo, b);
  } else {
    newCost = cost(qYes, qNo - safeSharesToSell, b);
  }

  let payout = currentCost - newCost;
  if (payout < 0 && Math.abs(payout) < 1e-9) payout = 0;

  const newQYes = side === 'YES' ? qYes - safeSharesToSell : qYes;
  const newQNo = side === 'NO' ? qNo - safeSharesToSell : qNo;
  if (newQYes < -b * 20 || newQNo < -b * 20) {
    throw new Error('Sell amount exceeds safe pool bounds');
  }
  const newProbability = price(newQYes, newQNo, b);

  if (isNaN(payout) || isNaN(newProbability)) {
    throw new Error('Invalid calculation: NaN result');
  }

  return {
    payout: Math.max(0, payout),
    newPool: { yes: newQYes, no: newQNo },
    newProbability: Math.max(0, Math.min(1, newProbability))
  };
}

export function getPrice(outstandingShares, b = DEFAULT_B) {
  const { yes: qYes, no: qNo } = normalizePool(outstandingShares);
  assertPositiveB(b);
  const rawPrice = price(qYes, qNo, b);
  return Math.max(0, Math.min(1, rawPrice));
}

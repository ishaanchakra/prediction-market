import { initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

initializeApp()

const db = getFirestore()

const MARKET_STATUS = {
  OPEN: 'OPEN',
  LOCKED: 'LOCKED',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED'
}
const ADMIN_EMAILS = new Set(['ic367@cornell.edu'])

const DEFAULT_B = 100
const SIGNIFICANT_TRADE_MIN_TRADES = 5
const SIGNIFICANT_TRADE_MIN_PROB_CHANGE = 0.05

function getMarketStatus(market) {
  if (!market) return MARKET_STATUS.OPEN
  if (market.status) return market.status
  if (market.resolution) return MARKET_STATUS.RESOLVED
  return MARKET_STATUS.OPEN
}

function cost(qYes, qNo, b = DEFAULT_B) {
  // Use log-sum-exp trick for numerical stability:
  // b * ln(e^(qYes/b) + e^(qNo/b))
  // = b * (max + ln(e^((qYes-max)/b) + e^((qNo-max)/b)))
  const max = Math.max(qYes, qNo)
  return b * (max / b + Math.log(Math.exp((qYes - max) / b) + Math.exp((qNo - max) / b)))
}

function price(qYes, qNo, b = DEFAULT_B) {
  // Softmax for numerical stability
  const max = Math.max(qYes, qNo)
  const expYes = Math.exp((qYes - max) / b)
  const expNo = Math.exp((qNo - max) / b)
  return expYes / (expYes + expNo)
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`)
  }
}

function normalizePool(outstandingShares) {
  const { yes = 0, no = 0 } = outstandingShares || {}
  assertFiniteNumber(yes, 'yes')
  assertFiniteNumber(no, 'no')
  return { yes, no }
}

function assertPositiveB(b) {
  assertFiniteNumber(b, 'b')
  if (b <= 0) throw new Error('b must be positive')
}

function calculateBet(outstandingShares, betAmount, side, b = DEFAULT_B) {
  const { yes: qYes, no: qNo } = normalizePool(outstandingShares)
  assertPositiveB(b)
  assertFiniteNumber(betAmount, 'betAmount')
  if (betAmount <= 0) throw new Error('betAmount must be positive')

  const currentCost = cost(qYes, qNo, b)
  const currentPrice = price(qYes, qNo, b)

  // Binary search for how many shares the user gets for betAmount
  // Cost to buy n shares of YES = C(qYes + n, qNo) - C(qYes, qNo)
  let lo = 0
  const minPrice = Math.max(0.001, Math.min(currentPrice, 1 - currentPrice))
  let hi = (betAmount / minPrice) * 2
  let shares = 0

  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2
    let newCost
    if (side === 'YES') {
      newCost = cost(qYes + mid, qNo, b) - currentCost
    } else {
      newCost = cost(qYes, qNo + mid, b) - currentCost
    }

    if (Math.abs(newCost - betAmount) < 0.0001) {
      shares = mid
      break
    }
    if (newCost < betAmount) {
      lo = mid
    } else {
      hi = mid
    }
    shares = mid
  }

  const convergedCost =
    side === 'YES' ? cost(qYes + shares, qNo, b) - currentCost : cost(qYes, qNo + shares, b) - currentCost
  if (Math.abs(convergedCost - betAmount) > 0.01) {
    throw new Error('LMSR binary search failed to converge')
  }

  const newQYes = side === 'YES' ? qYes + shares : qYes
  const newQNo = side === 'NO' ? qNo + shares : qNo
  const newProbability = price(newQYes, newQNo, b)

  if (Number.isNaN(shares) || Number.isNaN(newProbability)) {
    throw new Error('Invalid calculation: NaN result')
  }

  return {
    shares: Math.max(0, shares),
    newProbability: Math.max(0, Math.min(1, newProbability)),
    newPool: { yes: newQYes, no: newQNo }
  }
}

function calculateSell(outstandingShares, sharesToSell, side, b = DEFAULT_B) {
  const { yes: qYes, no: qNo } = normalizePool(outstandingShares)
  assertPositiveB(b)
  assertFiniteNumber(sharesToSell, 'sharesToSell')
  if (sharesToSell <= 0) {
    return { payout: 0, newPool: { yes: qYes, no: qNo }, newProbability: price(qYes, qNo, b) }
  }
  let safeSharesToSell = sharesToSell
  if (side === 'YES') {
    safeSharesToSell = Math.min(sharesToSell, Math.max(0, qYes))
  }
  if (side === 'NO') {
    safeSharesToSell = Math.min(sharesToSell, Math.max(0, qNo))
  }

  const currentCost = cost(qYes, qNo, b)

  let newCost
  if (side === 'YES') {
    newCost = cost(qYes - safeSharesToSell, qNo, b)
  } else {
    newCost = cost(qYes, qNo - safeSharesToSell, b)
  }

  let payout = currentCost - newCost
  if (payout < 0 && Math.abs(payout) < 1e-9) payout = 0

  const newQYes = side === 'YES' ? qYes - safeSharesToSell : qYes
  const newQNo = side === 'NO' ? qNo - safeSharesToSell : qNo
  if (newQYes < -b * 20 || newQNo < -b * 20) {
    throw new Error('Sell amount exceeds safe pool bounds')
  }
  const newProbability = price(newQYes, newQNo, b)

  if (Number.isNaN(payout) || Number.isNaN(newProbability)) {
    throw new Error('Invalid calculation: NaN result')
  }

  return {
    payout: Math.max(0, payout),
    newPool: { yes: newQYes, no: newQNo },
    newProbability: Math.max(0, Math.min(1, newProbability))
  }
}

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100
}

function toMarketplaceMemberId(marketplaceId, userId) {
  return `${marketplaceId}_${userId}`
}

function normalizeMarketplaceId(value) {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'marketplaceId must be a string or null.')
  }
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${fieldName} is required.`)
  }
  return value.trim()
}

function normalizeSide(value, fieldName = 'side') {
  if (value !== 'YES' && value !== 'NO') {
    throw new HttpsError('invalid-argument', `${fieldName} must be YES or NO.`)
  }
  return value
}

function normalizePositiveNumber(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpsError('invalid-argument', `${fieldName} must be a positive number.`)
  }
  return parsed
}

const DOGFOOD_UIDS = new Set(
  (process.env.DOGFOOD_TEST_UIDS || '').split(',').map(s => s.trim()).filter(Boolean)
)

function assertAuthenticatedCornell(request) {
  const uid = request.auth?.uid
  const email = request.auth?.token?.email
  if (!uid) {
    throw new HttpsError('unauthenticated', 'You must be signed in to trade.')
  }
  // Dogfood bypass — only active when DOGFOOD_TEST_UIDS env var is explicitly set
  if (DOGFOOD_UIDS.has(uid)) {
    return { uid, email: email || 'dogfood@cornell.edu' }
  }
  if (typeof email !== 'string' || !email.toLowerCase().endsWith('@cornell.edu')) {
    throw new HttpsError('permission-denied', 'You must use a Cornell email address (@cornell.edu).')
  }
  return { uid, email }
}

function assertAdminCaller(request) {
  const { uid, email } = assertAuthenticatedCornell(request)
  const normalizedEmail = String(email).toLowerCase()
  if (!ADMIN_EMAILS.has(normalizedEmail)) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  return { uid, email: normalizedEmail }
}

function assertOpenMarket(market, lockedMessage) {
  if (getMarketStatus(market) !== MARKET_STATUS.OPEN) {
    throw new HttpsError('failed-precondition', lockedMessage)
  }
}

function assertMatchingMarketplaceScope(requestedMarketplaceId, marketMarketplaceId) {
  if (requestedMarketplaceId !== marketMarketplaceId) {
    throw new HttpsError('invalid-argument', 'Market scope mismatch. Refresh and try again.')
  }
}

function getWalletRef(userId, marketplaceId) {
  if (marketplaceId) {
    return db.collection('marketplaceMembers').doc(toMarketplaceMemberId(marketplaceId, userId))
  }
  return db.collection('users').doc(userId)
}

function getWalletMissingMessage(isMarketplaceMarket) {
  return isMarketplaceMarket
    ? 'Marketplace balance not found. Join this marketplace before trading.'
    : 'User profile not found. Please log out and log back in.'
}

function parseNumericBalance(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[$,\s]/g, '')
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getAvailableBalanceOrThrow(walletData, isMarketplaceMarket) {
  const balance = parseNumericBalance(walletData?.balance)
  if (Number.isFinite(balance)) {
    return balance
  }

  // Legacy fallback for accounts that still have pre-migration fields.
  const weeklyRep = parseNumericBalance(walletData?.weeklyRep)
  if (Number.isFinite(weeklyRep)) {
    return weeklyRep
  }
  const weeklyStartingBalance = parseNumericBalance(walletData?.weeklyStartingBalance)
  const weeklyNet = parseNumericBalance(walletData?.weeklyNet)
  if (Number.isFinite(weeklyStartingBalance) && Number.isFinite(weeklyNet)) {
    return weeklyStartingBalance + weeklyNet
  }

  console.error('Invalid wallet balance shape', {
    isMarketplaceMarket,
    walletKeys: Object.keys(walletData || {})
  })
  throw new HttpsError('failed-precondition', 'Balance data is invalid. Please log out and sign back in.')
}

function getMarketLiquidityForSide(outstandingShares, side) {
  const sideValue = side === 'YES'
    ? Number(outstandingShares?.yes ?? 0)
    : Number(outstandingShares?.no ?? 0)
  return Number.isFinite(sideValue) ? Math.max(0, sideValue) : 0
}

function aggregateHeldShares(bets) {
  let yesShares = 0
  let noShares = 0

  for (const bet of bets) {
    const shares = Math.abs(Number(bet?.shares || 0))
    if (!Number.isFinite(shares) || shares <= 0) continue

    if (bet.side === 'YES') {
      yesShares += bet.type === 'SELL' ? -shares : shares
    } else if (bet.side === 'NO') {
      noShares += bet.type === 'SELL' ? -shares : shares
    }
  }

  const clean = (value) => {
    if (Math.abs(value) < 0.001) return 0
    return Math.max(0, value)
  }

  return {
    yesShares: clean(yesShares),
    noShares: clean(noShares)
  }
}

function mapPlaceBetCalculationError(error) {
  const message = String(error?.message || '')
  if (message.includes('LMSR binary search failed to converge')) {
    throw new HttpsError('invalid-argument', 'Could not calculate shares for that amount. Please try a different amount.')
  }
  throw new HttpsError('invalid-argument', 'Could not calculate this trade. Please check your amount and try again.')
}

function mapSellCalculationError(error) {
  throw new HttpsError('invalid-argument', 'Could not calculate payout for that sale. Please try a smaller amount.')
}

function validateSellResult(result) {
  if (!Number.isFinite(result.payout) || result.payout <= 0 || result.payout > 1_000_000) {
    throw new HttpsError('failed-precondition', 'Invalid sell payout calculated.')
  }
}

function toHttpsError(error, fallbackMessage) {
  if (error instanceof HttpsError) return error
  console.error(error)
  return new HttpsError('internal', fallbackMessage)
}

function chunkArray(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function timestampToDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function getMondayOfISOWeek(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export const placeBet = onCall(async (request) => {
  try {
    const { uid } = assertAuthenticatedCornell(request)
    const marketId = normalizeRequiredString(request.data?.marketId, 'marketId')
    const side = normalizeSide(request.data?.side, 'side')
    const amount = normalizePositiveNumber(request.data?.amount, 'amount')
    const requestedMarketplaceId = normalizeMarketplaceId(request.data?.marketplaceId)

    const marketRef = db.collection('markets').doc(marketId)
    const walletRef = getWalletRef(uid, requestedMarketplaceId)
    const [marketSnap, walletSnap] = await Promise.all([marketRef.get(), walletRef.get()])

    if (!marketSnap.exists) {
      throw new HttpsError('not-found', 'Market not found.')
    }

    const marketData = marketSnap.data()
    const marketMarketplaceId = normalizeMarketplaceId(marketData?.marketplaceId)
    assertMatchingMarketplaceScope(requestedMarketplaceId, marketMarketplaceId)
    assertOpenMarket(marketData, 'Trading is currently locked for this market.')

    const isMarketplaceMarket = Boolean(marketMarketplaceId)
    if (!walletSnap.exists) {
      throw new HttpsError('failed-precondition', getWalletMissingMessage(isMarketplaceMarket))
    }

    const availableBalance = getAvailableBalanceOrThrow(walletSnap.data(), isMarketplaceMarket)
    if (availableBalance < amount) {
      throw new HttpsError('failed-precondition', `Insufficient balance. You have $${availableBalance.toFixed(2)} available.`)
    }

    try {
      calculateBet(
        marketData?.outstandingShares || { yes: 0, no: 0 },
        amount,
        side,
        marketData?.b
      )
    } catch (error) {
      mapPlaceBetCalculationError(error)
    }

    const txResult = await db.runTransaction(async (tx) => {
      const [latestMarketSnap, latestWalletSnap] = await Promise.all([
        tx.get(marketRef),
        tx.get(walletRef)
      ])

      if (!latestMarketSnap.exists) {
        throw new HttpsError('not-found', 'Market not found.')
      }

      const latestMarket = latestMarketSnap.data()
      const latestMarketplaceId = normalizeMarketplaceId(latestMarket?.marketplaceId)
      assertMatchingMarketplaceScope(requestedMarketplaceId, latestMarketplaceId)
      assertOpenMarket(latestMarket, 'Trading is currently locked for this market.')

      const txIsMarketplaceMarket = Boolean(latestMarketplaceId)
      if (!latestWalletSnap.exists) {
        throw new HttpsError('failed-precondition', getWalletMissingMessage(txIsMarketplaceMarket))
      }
      const walletData = latestWalletSnap.data()
      const latestBalance = getAvailableBalanceOrThrow(walletData, txIsMarketplaceMarket)
      if (latestBalance < amount) {
        throw new HttpsError('failed-precondition', `Insufficient balance. You have $${latestBalance.toFixed(2)} available.`)
      }
      const oldProbabilityRaw = Number(latestMarket?.probability)
      const oldProbability = Number.isFinite(oldProbabilityRaw)
        ? Math.max(0, Math.min(1, oldProbabilityRaw))
        : price(
          Number(latestMarket?.outstandingShares?.yes || 0),
          Number(latestMarket?.outstandingShares?.no || 0),
          latestMarket?.b
        )
      const marketProbabilityAtBet = price(
        Number(latestMarket?.outstandingShares?.yes || 0),
        Number(latestMarket?.outstandingShares?.no || 0),
        latestMarket?.b
      )

      let result
      try {
        result = calculateBet(
          latestMarket?.outstandingShares || { yes: 0, no: 0 },
          amount,
          side,
          latestMarket?.b
        )
      } catch (error) {
        mapPlaceBetCalculationError(error)
      }

      const now = new Date()
      const betRef = db.collection('bets').doc()
      tx.set(betRef, {
        userId: uid,
        marketId,
        marketplaceId: latestMarketplaceId,
        side,
        amount,
        shares: result.shares,
        probability: result.newProbability,
        marketProbabilityAtBet,
        timestamp: now,
        createdAt: now,
        type: 'BUY'
      })

      tx.update(marketRef, {
        outstandingShares: result.newPool,
        probability: result.newProbability,
        totalVolume: FieldValue.increment(amount)
      })

      if (txIsMarketplaceMarket) {
        tx.update(walletRef, {
          balance: round2(latestBalance - amount),
          updatedAt: now
        })
      } else {
        tx.update(walletRef, {
          balance: round2(latestBalance - amount)
        })
      }

      return {
        shares: result.shares,
        newProbability: result.newProbability,
        newPool: result.newPool,
        oldProbability,
        marketQuestion: latestMarket?.question || 'Market',
        marketplaceId: latestMarketplaceId
      }
    })

    try {
      const probabilityChange = Number((Number(txResult.newProbability || 0) - Number(txResult.oldProbability || 0)).toFixed(4))
      if (Math.abs(probabilityChange) >= SIGNIFICANT_TRADE_MIN_PROB_CHANGE) {
        const marketBetsSnap = await db.collection('bets')
          .where('marketId', '==', marketId)
          .where('marketplaceId', '==', (txResult.marketplaceId ?? null))
          .get()

        const tradeCountByUser = {}
        const positionByUser = {}

        for (const betDoc of marketBetsSnap.docs) {
          const bet = betDoc.data()
          const betUserId = bet?.userId
          if (!betUserId) continue

          tradeCountByUser[betUserId] = (tradeCountByUser[betUserId] || 0) + 1

          if (!positionByUser[betUserId]) {
            positionByUser[betUserId] = { yesShares: 0, noShares: 0 }
          }
          const held = positionByUser[betUserId]
          const betSide = bet?.side === 'NO' ? 'NO' : 'YES'
          const betType = bet?.type === 'SELL' ? 'SELL' : 'BUY'
          const shares = Math.abs(Number(bet?.shares || 0))
          if (!Number.isFinite(shares) || shares <= 0) continue

          if (betSide === 'YES') {
            held.yesShares += betType === 'SELL' ? -shares : shares
          } else {
            held.noShares += betType === 'SELL' ? -shares : shares
          }
        }

        const recipients = []
        for (const [betUserId, held] of Object.entries(positionByUser)) {
          const yesShares = Math.max(0, round2(held.yesShares))
          const noShares = Math.max(0, round2(held.noShares))
          if (yesShares <= 0 && noShares <= 0) continue
          if (betUserId === uid) continue

          const tradeCount = Number(tradeCountByUser[betUserId] || 0)
          if (tradeCount < SIGNIFICANT_TRADE_MIN_TRADES) continue

          let userSide = null
          if (yesShares > noShares) userSide = 'YES'
          if (noShares > yesShares) userSide = 'NO'

          recipients.push({
            userId: betUserId,
            userSide,
            tradeCount
          })
        }

        const chunks = chunkArray(recipients, 400)
        for (const chunk of chunks) {
          const batch = db.batch()
          for (const recipient of chunk) {
            const notificationRef = db.collection('notifications').doc()
            batch.set(notificationRef, {
              userId: recipient.userId,
              type: 'significant_trade',
              category: 'MARKET_MOVED',
              marketId,
              marketQuestion: txResult.marketQuestion,
              tradeSide: side,
              oldProbability: Number(txResult.oldProbability || 0),
              newProbability: Number(txResult.newProbability || 0),
              probabilityChange,
              userSide: recipient.userSide,
              tradeCount: recipient.tradeCount,
              read: false,
              createdAt: new Date()
            })
          }
          await batch.commit()
        }
      }
    } catch (notificationError) {
      console.error('Error creating significant_trade notifications:', notificationError)
    }

    return txResult
  } catch (error) {
    throw toHttpsError(error, 'Unable to place bet right now.')
  }
})

export const sellShares = onCall(async (request) => {
  try {
    const { uid } = assertAuthenticatedCornell(request)
    const marketId = normalizeRequiredString(request.data?.marketId, 'marketId')
    const side = normalizeSide(request.data?.side, 'side')
    const sharesToSell = normalizePositiveNumber(request.data?.sharesToSell, 'sharesToSell')
    const requestedMarketplaceId = normalizeMarketplaceId(request.data?.marketplaceId)

    const marketRef = db.collection('markets').doc(marketId)
    const marketSnap = await marketRef.get()
    if (!marketSnap.exists) {
      throw new HttpsError('not-found', 'Market not found.')
    }

    const marketData = marketSnap.data()
    const marketMarketplaceId = normalizeMarketplaceId(marketData?.marketplaceId)
    assertMatchingMarketplaceScope(requestedMarketplaceId, marketMarketplaceId)
    assertOpenMarket(marketData, 'Selling is unavailable while this market is locked or closed.')

    const isMarketplaceMarket = Boolean(marketMarketplaceId)
    const walletRef = getWalletRef(uid, marketMarketplaceId)
    const userBetsQuery = db.collection('bets')
      .where('marketId', '==', marketId)
      .where('marketplaceId', '==', marketMarketplaceId)
      .where('userId', '==', uid)
    const [walletSnap, userBetsSnapshot] = await Promise.all([walletRef.get(), userBetsQuery.get()])
    if (!walletSnap.exists) {
      throw new HttpsError('failed-precondition', getWalletMissingMessage(isMarketplaceMarket))
    }
    const heldShares = aggregateHeldShares(userBetsSnapshot.docs.map((snapshot) => snapshot.data()))
    const availableShares = side === 'YES' ? heldShares.yesShares : heldShares.noShares
    if (sharesToSell > availableShares) {
      throw new HttpsError('failed-precondition', `Insufficient shares. You have ${availableShares.toFixed(2)} ${side} shares.`)
    }

    const sideLiquidity = getMarketLiquidityForSide(marketData?.outstandingShares, side)
    if (sharesToSell > sideLiquidity) {
      throw new HttpsError('failed-precondition', 'Sell amount exceeds current market liquidity. Please try a smaller amount.')
    }

    try {
      calculateSell(
        marketData?.outstandingShares || { yes: 0, no: 0 },
        sharesToSell,
        side,
        marketData?.b
      )
    } catch (error) {
      mapSellCalculationError(error)
    }

    const txResult = await db.runTransaction(async (tx) => {
      const [latestMarketSnap, latestWalletSnap, latestBetsSnapshot] = await Promise.all([
        tx.get(marketRef),
        tx.get(walletRef),
        tx.get(userBetsQuery)
      ])

      if (!latestMarketSnap.exists) {
        throw new HttpsError('not-found', 'Market not found.')
      }

      const latestMarket = latestMarketSnap.data()
      const latestMarketplaceId = normalizeMarketplaceId(latestMarket?.marketplaceId)
      assertMatchingMarketplaceScope(requestedMarketplaceId, latestMarketplaceId)
      assertOpenMarket(latestMarket, 'Selling is unavailable while this market is locked or closed.')

      const txIsMarketplaceMarket = Boolean(latestMarketplaceId)
      if (!latestWalletSnap.exists) {
        throw new HttpsError('failed-precondition', getWalletMissingMessage(txIsMarketplaceMarket))
      }

      const latestHeldShares = aggregateHeldShares(latestBetsSnapshot.docs.map((snapshot) => snapshot.data()))
      const latestAvailableShares = side === 'YES' ? latestHeldShares.yesShares : latestHeldShares.noShares
      if (sharesToSell > latestAvailableShares) {
        throw new HttpsError('failed-precondition', `Insufficient shares. You have ${latestAvailableShares.toFixed(2)} ${side} shares.`)
      }

      const latestSideLiquidity = getMarketLiquidityForSide(latestMarket?.outstandingShares, side)
      if (sharesToSell > latestSideLiquidity) {
        throw new HttpsError('failed-precondition', 'Sell amount exceeds current market liquidity. Please try a smaller amount.')
      }

      let result
      try {
        result = calculateSell(
          latestMarket?.outstandingShares || { yes: 0, no: 0 },
          sharesToSell,
          side,
          latestMarket?.b
        )
      } catch (error) {
        mapSellCalculationError(error)
      }
      validateSellResult(result)
      const marketProbabilityAtBet = price(
        Number(latestMarket?.outstandingShares?.yes || 0),
        Number(latestMarket?.outstandingShares?.no || 0),
        latestMarket?.b
      )

      const walletData = latestWalletSnap.data()
      const currentBalance = getAvailableBalanceOrThrow(walletData, txIsMarketplaceMarket)
      const now = new Date()
      const betRef = db.collection('bets').doc()
      tx.set(betRef, {
        userId: uid,
        marketId,
        marketplaceId: latestMarketplaceId,
        side,
        amount: -result.payout,
        shares: -sharesToSell,
        probability: result.newProbability,
        marketProbabilityAtBet,
        timestamp: now,
        createdAt: now,
        type: 'SELL'
      })

      tx.update(marketRef, {
        outstandingShares: result.newPool,
        probability: result.newProbability,
        totalVolume: FieldValue.increment(result.payout)
      })

      if (txIsMarketplaceMarket) {
        tx.update(walletRef, {
          balance: round2(currentBalance + result.payout),
          updatedAt: now
        })
      } else {
        tx.update(walletRef, {
          balance: round2(currentBalance + result.payout)
        })
      }

      return {
        payout: result.payout,
        newProbability: result.newProbability,
        newPool: result.newPool
      }
    })

    return txResult
  } catch (error) {
    throw toHttpsError(error, 'Unable to sell shares right now.')
  }
})

export const distributeStipend = onCall(async (request) => {
  try {
    const STIPEND_AMOUNT = 50
    const { email } = assertAdminCaller(request)
    const currentISOWeek = getISOWeek()
    const mondayOfWeek = getMondayOfISOWeek()

    const usersSnapshot = await db.collection('users')
      .where('onboardingComplete', '==', true)
      .get()
    const users = usersSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))

    let distributedCount = 0
    let skippedCount = 0
    const operations = []

    for (const user of users) {
      if (user.lastStipendWeek === currentISOWeek) {
        skippedCount += 1
        continue
      }

      const accountCreated = timestampToDate(user.accountCreatedAt || user.createdAt)
      if (accountCreated && accountCreated.getTime() >= mondayOfWeek.getTime()) {
        skippedCount += 1
        continue
      }

      operations.push({ id: user.id })
    }

    if (operations.length > 0) {
      const chunks = chunkArray(operations, 400)
      for (const chunk of chunks) {
        const userBatch = db.batch()
        const notificationBatch = db.batch()

        for (const row of chunk) {
          const userRef = db.collection('users').doc(row.id)
          userBatch.update(userRef, {
            balance: FieldValue.increment(STIPEND_AMOUNT),
            totalDeposits: FieldValue.increment(STIPEND_AMOUNT),
            lastStipendWeek: currentISOWeek
          })

          const notificationRef = db.collection('notifications').doc()
          notificationBatch.set(notificationRef, {
            userId: row.id,
            type: 'stipend',
            category: 'RANK_CHANGED',
            message: 'You received your weekly $50 stipend.',
            read: false,
            createdAt: FieldValue.serverTimestamp()
          })
        }

        await Promise.all([userBatch.commit(), notificationBatch.commit()])
        distributedCount += chunk.length
      }

      await db.collection('adminLog').add({
        action: 'STIPEND_DISTRIBUTE',
        detail: `Weekly stipend of $${STIPEND_AMOUNT} distributed to ${distributedCount} users (week ${currentISOWeek}).`,
        actor: email,
        timestamp: new Date()
      })
    }

    return {
      eligible: users.length,
      distributed: distributedCount,
      skipped: skippedCount
    }
  } catch (error) {
    throw toHttpsError(error, 'Unable to distribute stipend right now.')
  }
})

export const migrateUserEmailsToPrivate = onCall(async (request) => {
  try {
    const { email } = assertAdminCaller(request)
    const dryRun = Boolean(request.data?.dryRun)
    const requestedBatchSize = Number(request.data?.batchSize)
    const batchSize = Number.isFinite(requestedBatchSize) && requestedBatchSize > 0
      ? Math.min(200, Math.floor(requestedBatchSize))
      : 200

    let scanned = 0
    let migrated = 0
    let alreadyClean = 0
    let pages = 0
    let lastDoc = null

    while (true) {
      let usersQuery = db.collection('users')
        .orderBy(FieldPath.documentId())
        .limit(batchSize)
      if (lastDoc) {
        usersQuery = usersQuery.startAfter(lastDoc)
      }

      const usersSnapshot = await usersQuery.get()
      if (usersSnapshot.empty) break
      pages += 1

      const batch = dryRun ? null : db.batch()
      let batchOps = 0

      for (const userDoc of usersSnapshot.docs) {
        scanned += 1
        const rawEmail = typeof userDoc.data()?.email === 'string'
          ? userDoc.data().email.trim().toLowerCase()
          : ''

        if (!rawEmail) {
          alreadyClean += 1
          continue
        }

        migrated += 1
        if (!dryRun) {
          const privateRef = db.collection('userPrivate').doc(userDoc.id)
          batch.set(privateRef, {
            email: rawEmail,
            updatedAt: new Date()
          }, { merge: true })
          batch.update(userDoc.ref, {
            email: FieldValue.delete()
          })
          batchOps += 2
        }
      }

      if (!dryRun && batchOps > 0) {
        await batch.commit()
      }

      lastDoc = usersSnapshot.docs[usersSnapshot.docs.length - 1]
    }

    return {
      dryRun,
      batchSize,
      scanned,
      migrated,
      alreadyClean,
      pages,
      executedBy: email
    }
  } catch (error) {
    throw toHttpsError(error, 'Unable to migrate user emails right now.')
  }
})

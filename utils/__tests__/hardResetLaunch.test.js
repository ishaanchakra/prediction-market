const fs = require('fs');
const path = require('path');

const {
  BATCH_LIMIT,
  DEFAULT_MARKET_B,
  LEADERBOARD_CACHE_COLLECTIONS,
  chunkArray,
  normalizeProbability,
  resolveInitialProbability,
  resolveMarketB,
  buildMarketResetPatch,
  resolveAccountCreatedAt,
  buildUserResetPatch,
  deleteCollectionDocuments,
  clearLeaderboardCaches
} = require('../../scripts/hard-reset-launch');

function readScript() {
  return fs.readFileSync(path.resolve(__dirname, '../../scripts/hard-reset-launch.js'), 'utf8');
}

describe('hard-reset-launch helpers', () => {
  const fakeDeleteToken = { __type: 'DELETE' };
  const fakeServerTimestampToken = { __type: 'SERVER_TIMESTAMP' };
  const fakeFieldValue = {
    delete: jest.fn(() => fakeDeleteToken),
    serverTimestamp: jest.fn(() => fakeServerTimestampToken)
  };

  beforeEach(() => {
    fakeFieldValue.delete.mockClear();
    fakeFieldValue.serverTimestamp.mockClear();
  });

  test('chunkArray splits >500 docs into multiple batches', () => {
    const docs = Array.from({ length: 1201 }, (_, idx) => idx);
    const chunks = chunkArray(docs, BATCH_LIMIT);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[1]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(201);
  });

  test('accountCreatedAt uses existing accountCreatedAt when present', () => {
    const existing = { accountCreatedAt: { seconds: 100 } };
    const resolved = resolveAccountCreatedAt(existing, fakeFieldValue);

    expect(resolved.source).toBe('accountCreatedAt');
    expect(resolved.value).toBe(existing.accountCreatedAt);
    expect(fakeFieldValue.serverTimestamp).not.toHaveBeenCalled();
  });

  test('accountCreatedAt falls back to createdAt when accountCreatedAt missing', () => {
    const existing = { createdAt: { seconds: 200 } };
    const resolved = resolveAccountCreatedAt(existing, fakeFieldValue);

    expect(resolved.source).toBe('createdAt');
    expect(resolved.value).toBe(existing.createdAt);
    expect(fakeFieldValue.serverTimestamp).not.toHaveBeenCalled();
  });

  test('accountCreatedAt uses serverTimestamp when both timestamps are missing', () => {
    const resolved = resolveAccountCreatedAt({}, fakeFieldValue);

    expect(resolved.source).toBe('serverTimestamp()');
    expect(resolved.value).toBe(fakeServerTimestampToken);
    expect(fakeFieldValue.serverTimestamp).toHaveBeenCalledTimes(1);
  });

  test('buildUserResetPatch deletes legacy fields when present', () => {
    const existing = {
      weeklyRep: 1200,
      weeklyStartingBalance: 1000,
      weeklyNet: 200
    };

    const { patch, removedLegacyFields } = buildUserResetPatch(existing, fakeFieldValue);

    expect(patch.balance).toBe(1000);
    expect(patch.totalDeposits).toBe(1000);
    expect(patch.onboardingComplete).toBe(true);
    expect(patch.quickTakesUsedToday).toBe(0);
    expect(patch.quickTakeLastDate).toBeNull();
    expect(patch.quickTakeStreak).toBe(0);
    expect(patch.lastStipendWeek).toBeNull();
    expect(patch.lifetimeRep).toBe(0);
    expect(patch.weeklyRep).toBe(fakeDeleteToken);
    expect(patch.weeklyStartingBalance).toBe(fakeDeleteToken);
    expect(patch.weeklyNet).toBe(fakeDeleteToken);
    expect(removedLegacyFields).toEqual(['weeklyRep', 'weeklyStartingBalance', 'weeklyNet']);
    expect(fakeFieldValue.delete).toHaveBeenCalledTimes(3);
  });

  test('buildUserResetPatch leaves legacy delete ops out when fields are absent', () => {
    const { patch, removedLegacyFields } = buildUserResetPatch({ displayName: 'A' }, fakeFieldValue);

    expect(removedLegacyFields).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(patch, 'weeklyRep')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, 'weeklyStartingBalance')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, 'weeklyNet')).toBe(false);
    expect(fakeFieldValue.delete).not.toHaveBeenCalled();
  });

  test('market probability normalization supports decimal and percentage input', () => {
    expect(normalizeProbability(0.63)).toBe(0.63);
    expect(normalizeProbability(63)).toBe(0.63);
    expect(normalizeProbability(0)).toBe(0.01);
    expect(normalizeProbability(1)).toBe(0.99);
    expect(normalizeProbability('bad')).toBeNull();
  });

  test('resolveInitialProbability prefers initialProbability then probability then default', () => {
    expect(resolveInitialProbability({ initialProbability: 0.7 })).toEqual({ value: 0.7, source: 'initialProbability' });
    expect(resolveInitialProbability({ probability: 0.42 })).toEqual({ value: 0.42, source: 'probability' });
    expect(resolveInitialProbability({})).toEqual({ value: 0.5, source: 'default(0.5)' });
  });

  test('resolveMarketB uses positive b or default', () => {
    expect(resolveMarketB({ b: 50 })).toBe(50);
    expect(resolveMarketB({ b: 0 })).toBe(DEFAULT_MARKET_B);
    expect(resolveMarketB({})).toBe(DEFAULT_MARKET_B);
  });

  test('buildMarketResetPatch resets pool and trade counters', () => {
    const { patch, probabilitySource, b } = buildMarketResetPatch({ initialProbability: 0.63, b: 100 }, fakeFieldValue);
    expect(probabilitySource).toBe('initialProbability');
    expect(b).toBe(100);
    expect(patch.probability).toBe(0.63);
    expect(patch.initialProbability).toBe(0.63);
    expect(patch.outstandingShares.no).toBe(0);
    expect(typeof patch.outstandingShares.yes).toBe('number');
    expect(patch.totalTraded).toBe(0);
    expect(patch.tradeCount).toBe(0);
    expect(patch.lastTradeAt).toBe(fakeDeleteToken);
  });

  test('script only clears configured leaderboard cache collections', async () => {
    const calls = [];
    const mockDb = {
      collection: jest.fn((name) => ({
        get: jest.fn().mockImplementation(async () => {
          calls.push(name);
          return { size: 0, docs: [] };
        })
      }))
    };
    const result = await clearLeaderboardCaches(mockDb, { dryRun: true });
    expect(Object.keys(result)).toEqual(LEADERBOARD_CACHE_COLLECTIONS);
    expect(calls).toEqual(LEADERBOARD_CACHE_COLLECTIONS);
  });

  test('script does not target displayNames or userPrivate collections', () => {
    const source = readScript();
    expect(source).not.toContain("collectionName, 'displayNames'");
    expect(source).not.toContain("collectionName, 'userPrivate'");
    expect(source).toContain("'bets'");
    expect(source).toContain("'weeklySnapshots'");
  });

  test('deleteCollectionDocuments dry-run handles empty collections', async () => {
    const mockDb = {
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          size: 0,
          empty: true,
          docs: []
        })
      }))
    };

    const deleted = await deleteCollectionDocuments(mockDb, 'bets', { dryRun: true });
    expect(deleted).toBe(0);
    expect(mockDb.collection).toHaveBeenCalledWith('bets');
  });

  test('deleteCollectionDocuments dry-run reports all docs when count exceeds batch size', async () => {
    const docCount = 1001;
    const docs = Array.from({ length: docCount }, (_, index) => ({ id: String(index), ref: { id: String(index) } }));
    const mockDb = {
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          size: docCount,
          empty: false,
          docs
        })
      }))
    };

    const deleted = await deleteCollectionDocuments(mockDb, 'markets', { dryRun: true });
    expect(deleted).toBe(docCount);
  });
});

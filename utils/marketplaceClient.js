import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toMarketplaceMemberId } from './marketplace';

export async function fetchMarketplaceContext(marketplaceId, userId) {
  const [marketplaceSnap, memberSnap] = await Promise.all([
    getDoc(doc(db, 'marketplaces', marketplaceId)),
    getDoc(doc(db, 'marketplaceMembers', toMarketplaceMemberId(marketplaceId, userId)))
  ]);

  return {
    marketplace: marketplaceSnap.exists() ? { id: marketplaceSnap.id, ...marketplaceSnap.data() } : null,
    membership: memberSnap.exists() ? { id: memberSnap.id, ...memberSnap.data() } : null
  };
}

export async function fetchMarketplaceMarkets(marketplaceId) {
  const marketQuery = query(
    collection(db, 'markets'),
    where('marketplaceId', '==', marketplaceId),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(marketQuery);
  return snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
}

export async function fetchMarketplaceBets(marketplaceId) {
  const betsQuery = query(
    collection(db, 'bets'),
    where('marketplaceId', '==', marketplaceId)
  );
  const snapshot = await getDocs(betsQuery);
  return snapshot.docs
    .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
    .sort((a, b) => {
      const aTime = a.timestamp?.toDate?.()?.getTime?.() || 0;
      const bTime = b.timestamp?.toDate?.()?.getTime?.() || 0;
      return bTime - aTime;
    });
}

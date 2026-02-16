'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, limit } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      await fetchNotifications(currentUser.uid);
    });

    return () => unsubscribe();
  }, [router]);

  async function fetchNotifications(userId) {
    try {
      setLoadError('');
      const q = query(collection(db, 'notifications'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(200));
      const snapshot = await getDocs(q);
      setNotifications(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setLoadError('Unable to load notifications right now.');
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(notificationId) {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), { read: true });
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }

  async function markAllAsRead() {
    try {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      await Promise.all(unreadIds.map((id) => updateDoc(doc(db, 'notifications', id), { read: true })));
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;

  const unreadCount = notifications.filter((n) => !n.read).length;
  const unreadNotifications = notifications.filter((n) => !n.read);
  const readNotifications = notifications.filter((n) => n.read);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto bg-[var(--bg)] min-h-screen">
      {loadError && (
        <div className="mb-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
          {loadError}
        </div>
      )}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Notifications</h1>
          {unreadCount > 0 && <p className="text-sm text-white opacity-80 mt-1">{unreadCount} unread</p>}
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} className="w-full rounded border border-[var(--border2)] px-3 py-2 text-sm text-white hover:text-brand-lightpink md:w-auto">
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg">
          <p className="text-[var(--text-muted)]">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {unreadNotifications.length > 0 && (
            <section>
              <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">Unread</p>
              <div className="space-y-3">
                {unreadNotifications.map((notif) => (
                  <NotificationRow key={notif.id} notif={notif} unread onClickRead={markAsRead} />
                ))}
              </div>
            </section>
          )}
          {readNotifications.length > 0 && (
            <section className="border-t border-[var(--border)] pt-5">
              <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Read</p>
              <div className="space-y-3">
                {readNotifications.map((notif) => (
                  <NotificationRow key={notif.id} notif={notif} unread={false} onClickRead={markAsRead} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ notif, unread, onClickRead }) {
  return (
    <Link
      href={`/market/${notif.marketId}`}
      onClick={() => unread && onClickRead(notif.id)}
      className={`block min-h-[60px] rounded-lg border-2 p-4 transition-all ${
        unread
          ? 'bg-[var(--surface)] border-brand-pink hover:border-brand-red shadow-md'
          : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border2)]'
      }`}
    >
      {notif.type === 'payout' && (
        <>
          <HeaderEmoji emoji="💰" unread={unread} />
          <p className="font-semibold text-[var(--text)] mb-1">Your side won</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">{notif.marketQuestion}</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">If resolved {notif.resolution}, {notif.resolution} shares paid out.</p>
          <span className="text-green-600 font-bold">+${Number(notif.amount || 0).toFixed(2)} added to your balance</span>
          <TimeLabel createdAt={notif.createdAt} />
        </>
      )}

      {notif.type === 'loss' && (
        <>
          <HeaderEmoji emoji="📉" unread={unread} />
          <p className="font-semibold text-[var(--text)] mb-1">Market resolved against your side</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">{notif.marketQuestion}</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">Resolved: {notif.resolution}</p>
          <span className="text-red-600 font-bold">-${Number(notif.amount || 0).toFixed(2)} was not recovered</span>
          <TimeLabel createdAt={notif.createdAt} />
        </>
      )}

      {notif.type === 'refund' && (
        <>
          <HeaderEmoji emoji="↩️" unread={unread} />
          <p className="font-semibold text-[var(--text)] mb-1">Market cancelled + refund sent</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">{notif.marketQuestion}</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">This market was cancelled before resolution.</p>
          <span className="text-blue-700 font-bold">+${Number(notif.amount || 0).toFixed(2)} refunded to your balance</span>
          <TimeLabel createdAt={notif.createdAt} />
        </>
      )}

      {notif.type === 'significant_trade' && (
        <>
          <HeaderEmoji emoji="🐋" unread={unread} />
          <p className="font-semibold text-[var(--text)] mb-1">Large trade alert</p>
          <p className="text-sm text-[var(--text-dim)] mb-2">{notif.marketQuestion}</p>
          <div className="text-sm text-[var(--text-dim)] space-y-1">
            <p>
              <span className="font-semibold">{notif.traderNetid}</span> placed a{' '}
              <span className={`font-bold ${notif.tradeSide === 'YES' ? 'text-green-600' : 'text-red-600'}`}>
                ${notif.tradeAmount} {notif.tradeSide}
              </span>{' '}
              trade
            </p>
            <p>
              Price moved: {notif.oldProbability}% → {notif.newProbability}% ({notif.probabilityChange})
            </p>
          </div>
          <TimeLabel createdAt={notif.createdAt} />
        </>
      )}
    </Link>
  );
}

function HeaderEmoji({ emoji, unread }) {
  return (
    <div className="flex items-start justify-between mb-2">
      <span className="text-2xl">{emoji}</span>
      {unread && <span className="bg-[var(--bg)] text-white text-xs font-bold px-2 py-1 rounded-full">NEW</span>}
    </div>
  );
}

function TimeLabel({ createdAt }) {
  return <p className="text-xs text-[var(--text-muted)] mt-2">{createdAt?.toDate?.()?.toLocaleString?.() || 'Recently'}</p>;
}

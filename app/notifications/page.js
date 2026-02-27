'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, limit, writeBatch } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function fmtMoney(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatRelativeTime(createdAt) {
  const date = createdAt?.toDate?.() || (createdAt ? new Date(createdAt) : null);
  if (!date || Number.isNaN(date.getTime())) return 'Recently';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toProbabilityPercent(probability) {
  const value = Number(probability || 0);
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

function StripItem({ label, value, valueColor }) {
  return (
    <div className="flex items-center gap-1 font-mono text-[0.48rem] uppercase tracking-[0.07em] text-[var(--text-muted)]">
      {label}
      {value && (
        <strong className="ml-[3px]" style={{ color: valueColor || 'var(--text-dim)' }}>
          {value}
        </strong>
      )}
    </div>
  );
}

function ProbMoveStrip({ oldPct, newPct, up }) {
  return (
    <div className="flex items-center gap-1 font-mono text-[0.48rem] uppercase tracking-[0.07em] text-[var(--text-muted)]">
      <strong className="text-[var(--text-dim)]">{oldPct}%</strong>
      <span className={`mx-1 font-bold ${up ? 'text-[var(--amber-bright)]' : 'text-[var(--red)]'}`}>→</span>
      <strong className="text-[var(--text-dim)]">{newPct}%</strong>
    </div>
  );
}

function getCardConfig(notif) {
  const type = notif.type;

  if (type === 'payout') {
    return {
      stripeColor: 'var(--green-bright)',
      iconBg: 'rgba(74,222,128,0.08)',
      iconBorder: 'rgba(74,222,128,0.2)',
      iconColor: 'var(--green-bright)',
      iconChar: '✓',
      headline: 'Your position won',
      amount: `+$${fmtMoney(notif.amount)}`,
      amountClass: 'text-[var(--green-bright)]',
      strip: (
        <>
          <StripItem label="Resolution" value={notif.resolution} valueColor="var(--green-bright)" />
          <StripItem label="Payout" value={`${fmtMoney(notif.amount)} shares × $1`} />
        </>
      )
    };
  }

  if (type === 'loss') {
    return {
      stripeColor: 'var(--red)',
      iconBg: 'rgba(220,38,38,0.08)',
      iconBorder: 'rgba(220,38,38,0.2)',
      iconColor: 'var(--red)',
      iconChar: '✗',
      headline: 'Your position lost',
      amount: `−$${fmtMoney(notif.amount)}`,
      amountClass: 'text-[var(--red)]',
      strip: (
        <>
          <StripItem label="Resolution" value={notif.resolution} valueColor="var(--red)" />
          <StripItem label="Cost basis" value={`$${fmtMoney(notif.amount)}`} />
        </>
      )
    };
  }

  if (type === 'refund') {
    return {
      stripeColor: 'var(--amber-bright)',
      iconBg: 'rgba(251,191,36,0.06)',
      iconBorder: 'rgba(251,191,36,0.15)',
      iconColor: 'var(--amber-bright)',
      iconChar: '↩',
      headline: 'Market cancelled — refund processed',
      amount: `+$${fmtMoney(notif.amount)}`,
      amountClass: 'text-[var(--amber-bright)]',
      strip: (
        <>
          <StripItem label="Original stake" value={`$${fmtMoney(notif.amount)}`} />
          <StripItem label="Returned in full" />
        </>
      )
    };
  }

  if (type === 'significant_trade') {
    const oldPct = toProbabilityPercent(notif.oldProbability);
    const newPct = toProbabilityPercent(notif.newProbability);
    const deltaFromField = Number(notif.probabilityChange);
    const delta = Number.isFinite(deltaFromField) ? Math.round(deltaFromField * 100) : newPct - oldPct;
    const up = delta >= 0;
    const userSide = notif.userSide === 'YES' || notif.userSide === 'NO' ? notif.userSide : null;
    const helpful = userSide === 'YES' ? up : userSide === 'NO' ? !up : null;

    return {
      stripeColor: 'var(--amber-bright)',
      iconBg: up ? 'rgba(251,191,36,0.08)' : 'rgba(220,38,38,0.06)',
      iconBorder: up ? 'rgba(251,191,36,0.2)' : 'rgba(220,38,38,0.15)',
      iconColor: up ? 'var(--amber-bright)' : 'var(--red)',
      iconChar: up ? '↑' : '↓',
      headline: 'Price moved on your market',
      amount: `${delta >= 0 ? '+' : ''}${delta} pts`,
      amountClass: helpful === true
        ? 'text-[var(--amber-bright)]'
        : helpful === false
          ? 'text-[var(--red)]'
          : 'text-[var(--text-muted)]',
      strip: (
        <>
          <ProbMoveStrip oldPct={oldPct} newPct={newPct} up={up} />
          {Number(notif.tradeCount || 0) > 0 && <StripItem label={`${Number(notif.tradeCount || 0)} total trades in this market`} />}
          {userSide && (
            <span className={`ml-auto rounded-[3px] border px-2 py-[2px] font-mono text-[0.44rem] uppercase tracking-[0.08em] ${
              userSide === 'YES'
                ? 'border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.05)] text-[var(--green-bright)]'
                : 'border-[rgba(220,38,38,0.2)] bg-[rgba(220,38,38,0.05)] text-[var(--red)]'
            }`}>
              Your side: {userSide}
            </span>
          )}
        </>
      )
    };
  }

  if (type === 'stipend') {
    return {
      stripeColor: 'var(--blue-bright)',
      iconBg: 'rgba(96,165,250,0.08)',
      iconBorder: 'rgba(96,165,250,0.2)',
      iconColor: 'var(--blue-bright)',
      iconChar: '$',
      headline: 'Weekly stipend added',
      subline: notif.message || 'Balance replenished',
      amount: `+$${fmtMoney(notif.amount)}`,
      amountClass: 'text-[var(--blue-bright)]',
      strip: null
    };
  }

  if (type === 'admin_adjustment') {
    const amt = Number(notif.amount || 0);
    return {
      stripeColor: 'var(--border2)',
      iconBg: 'var(--surface3)',
      iconBorder: 'var(--border2)',
      iconColor: 'var(--text-muted)',
      iconChar: '⚙',
      headline: 'Balance adjusted by admin',
      subline: notif.message || 'Manual correction',
      amount: amt !== 0 ? `${amt >= 0 ? '+' : ''}$${fmtMoney(Math.abs(amt))}` : null,
      amountClass: 'text-[var(--text-muted)]',
      strip: null
    };
  }

  return {
    stripeColor: 'var(--border2)',
    iconBg: 'var(--surface3)',
    iconBorder: 'var(--border2)',
    iconColor: 'var(--text-muted)',
    iconChar: '·',
    headline: notif.message || 'Notification',
    subline: null,
    amount: null,
    amountClass: '',
    strip: null
  };
}

function SectionLabel({ color, children }) {
  return (
    <div className="flex items-center gap-[7px] pb-2 font-mono text-[0.5rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
      <span className="inline-block h-[5px] w-[5px] rounded-full flex-shrink-0" style={{ background: color }} />
      {children}
    </div>
  );
}

function NotificationCard({ notif, unread, onClickRead }) {
  const config = getCardConfig(notif);

  return (
    <Link
      href={notif.marketId ? `/market/${notif.marketId}` : '/notifications'}
      onClick={() => unread && onClickRead(notif.id)}
      className={`block overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface2)] ${
        unread ? '' : 'opacity-70 hover:opacity-100'
      }`}
      style={unread ? { borderLeft: `2px solid ${config.stripeColor}` } : undefined}
    >
      <div className="grid items-start gap-[10px] px-[14px] py-3" style={{ gridTemplateColumns: '32px 1fr auto' }}>
        <div
          className="mt-[2px] flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] border font-mono text-[0.7rem] font-bold"
          style={{ background: config.iconBg, borderColor: config.iconBorder, color: config.iconColor }}
        >
          {config.iconChar}
        </div>

        <div className="min-w-0">
          <div
            className="mb-[3px] flex flex-wrap items-center gap-[6px] text-[0.85rem] font-semibold leading-snug text-[var(--text)]"
            style={!unread ? { color: 'var(--text-dim)', fontWeight: 500 } : undefined}
          >
            {config.headline}
            {unread && (
              <span className="inline-flex items-center rounded-[3px] bg-[var(--red)] px-[5px] py-[2px] font-mono text-[0.38rem] font-bold uppercase tracking-[0.12em] text-white">
                New
              </span>
            )}
          </div>
          {notif.marketQuestion ? (
            <p
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.5rem] uppercase tracking-[0.06em] text-[var(--text-muted)]"
              style={{ maxWidth: '320px' }}
            >
              {notif.marketQuestion}
            </p>
          ) : config.subline ? (
            <p className="font-mono text-[0.5rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              {config.subline}
            </p>
          ) : null}
        </div>

        <div className="flex-shrink-0 text-right">
          {config.amount && (
            <span className={`block font-mono text-[0.82rem] font-bold leading-snug ${config.amountClass}`}>
              {config.amount}
            </span>
          )}
          <span className="mt-[3px] block font-mono text-[0.44rem] uppercase tracking-[0.07em] text-[var(--text-muted)]">
            {formatRelativeTime(notif.createdAt)}
          </span>
        </div>
      </div>

      {config.strip && (
        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] py-[7px] pl-[56px] pr-[14px]">
          {config.strip}
        </div>
      )}
    </Link>
  );
}

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
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      const chunks = [];
      for (let i = 0; i < unreadIds.length; i += 400) {
        chunks.push(unreadIds.slice(i, i + 400));
      }
      await Promise.all(
        chunks.map((chunk) => {
          const batch = writeBatch(db);
          chunk.forEach((id) => batch.update(doc(db, 'notifications', id), { read: true }));
          return batch.commit();
        })
      );
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  const unreadNotifications = notifications.filter((n) => !n.read);
  const readNotifications = notifications.filter((n) => n.read);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="mx-auto max-w-[680px] px-5 pb-20">
        <div className="flex items-baseline justify-between border-b border-[var(--border)] py-7">
          <h1 className="font-display text-[2.2rem] italic text-[var(--text)]">Notifications</h1>
          <div className="flex items-center gap-3">
            {unreadNotifications.length > 0 && (
              <span className="font-mono text-[0.5rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="text-[var(--red)]">{unreadNotifications.length}</span> unread
              </span>
            )}
            {unreadNotifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="rounded border border-[var(--border2)] px-[10px] py-[5px] font-mono text-[0.5rem] uppercase tracking-[0.1em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-dim)]"
              >
                Mark all read
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
            {loadError}
          </div>
        )}

        {loading && (
          <p className="py-12 text-center font-mono text-[0.62rem] text-[var(--text-muted)]">
            Loading...
          </p>
        )}

        {!loading && notifications.length === 0 && (
          <div className="mt-6 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">No notifications yet</p>
          </div>
        )}

        {!loading && unreadNotifications.length > 0 && (
          <div className="mt-5">
            <SectionLabel color="var(--red)">Unread</SectionLabel>
            <div className="flex flex-col gap-[6px]">
              {unreadNotifications.map((notif) => (
                <NotificationCard key={notif.id} notif={notif} unread onClickRead={markAsRead} />
              ))}
            </div>
          </div>
        )}

        {!loading && readNotifications.length > 0 && (
          <div className="mt-6">
            <hr className="mb-4 border-[var(--border)]" />
            <SectionLabel color="var(--border2)">Read</SectionLabel>
            <div className="flex flex-col gap-[6px]">
              {readNotifications.map((notif) => (
                <NotificationCard key={notif.id} notif={notif} unread={false} onClickRead={markAsRead} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

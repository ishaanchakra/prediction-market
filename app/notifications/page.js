'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
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
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const notifData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotifications(notifData);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(notificationId) {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        read: true
      });
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }

  async function markAllAsRead() {
    try {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      await Promise.all(
        unreadIds.map(id => updateDoc(doc(db, 'notifications', id), { read: true }))
      );
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  if (loading) return <div className="p-8">Loading...</div>;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-600 mt-1">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No notifications yet.</p>
          <Link href="/" className="text-indigo-600 hover:underline mt-2 inline-block">
            Browse markets
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`border rounded-lg p-4 transition-colors ${
                notif.read ? 'bg-white' : 'bg-indigo-50 border-indigo-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">💰</span>
                    <span className={`text-sm font-semibold ${
                      notif.resolution === 'YES' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      Market Resolved: {notif.resolution}
                    </span>
                  </div>
                  
                  <Link
                    href={`/market/${notif.marketId}`}
                    className="font-medium text-gray-900 hover:text-indigo-600"
                  >
                    {notif.marketQuestion}
                  </Link>
                  
                  <p className="text-sm text-gray-600 mt-1">
                    You won <span className="font-bold text-green-600">+{notif.amount} rep</span>
                  </p>
                  
                  <p className="text-xs text-gray-500 mt-2">
                    {notif.createdAt?.toDate?.()?.toLocaleString() || 'Recently'}
                  </p>
                </div>

                {!notif.read && (
                  <button
                    onClick={() => markAsRead(notif.id)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 ml-4"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
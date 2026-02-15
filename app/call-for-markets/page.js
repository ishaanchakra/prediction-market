'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { addDoc, collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import Link from 'next/link';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';

const defaultForm = {
  question: '',
  initialProbability: 50,
  liquidityB: 100,
  resolutionRules: '',
  resolutionDate: '',
  rationale: ''
};

export default function CallForMarketsPage() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState([]);
  const { toasts, notifySuccess, notifyError, removeToast, resolveConfirm } = useToastQueue();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchMyRequests(currentUser.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  async function fetchMyRequests(uid) {
    try {
      const q = query(collection(db, 'marketRequests'), where('submittedBy', '==', uid), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      setRequests(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error fetching market requests:', error);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user) return;

    if (!form.question.trim() || !form.resolutionRules.trim() || !form.resolutionDate) {
      notifyError('Please fill all required fields.');
      return;
    }

    if (form.initialProbability < 1 || form.initialProbability > 99) {
      notifyError('Initial probability must be 1-99%.');
      return;
    }

    const selectedDate = new Date(`${form.resolutionDate}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      notifyError('Resolution date cannot be in the past.');
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'marketRequests'), {
        submittedBy: user.uid,
        submitterDisplayName: user.email?.split('@')[0] || 'student',
        question: form.question.trim(),
        initialProbability: Number(form.initialProbability),
        liquidityB: Number(form.liquidityB),
        resolutionRules: form.resolutionRules.trim(),
        resolutionDate: new Date(form.resolutionDate),
        rationale: form.rationale.trim() || null,
        status: 'PENDING',
        adminNotes: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      setForm(defaultForm);
      await fetchMyRequests(user.uid);
      notifySuccess('Request submitted. Admins will review it.');
    } catch (error) {
      console.error('Error submitting request:', error);
      notifyError('Could not submit request right now.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto bg-[var(--bg)] min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">Call for Markets</h1>
      <p className="text-[var(--text-dim)] mb-6">Suggest markets you want to trade on. Include the rules for resolution.</p>

      {!user ? (
        <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
          <p className="text-[var(--text-dim)] mb-3">Sign in with your Cornell account to submit market ideas.</p>
          <Link href="/login" className="inline-block bg-[var(--bg)] text-white px-4 py-2 rounded-lg font-semibold">Sign In</Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Proposed Question *</label>
              <input type="text" value={form.question} onChange={(e) => setForm((prev) => ({ ...prev, question: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" placeholder="Will Cornell announce ...?" required />
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Initial Probability (%) *</label>
                <input type="number" min="1" max="99" value={form.initialProbability} onChange={(e) => setForm((prev) => ({ ...prev, initialProbability: Number(e.target.value) }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Liquidity (b) *</label>
                <input type="number" min="10" max="1000" step="10" value={form.liquidityB} onChange={(e) => setForm((prev) => ({ ...prev, liquidityB: Number(e.target.value) }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" required />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Resolution Rules *</label>
              <textarea value={form.resolutionRules} onChange={(e) => setForm((prev) => ({ ...prev, resolutionRules: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" rows={4} placeholder="Exactly what evidence/source determines YES vs NO" required />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Target Resolution Date *</label>
              <input type="date" value={form.resolutionDate} onChange={(e) => setForm((prev) => ({ ...prev, resolutionDate: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" required />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Why this market? (optional)</label>
              <textarea value={form.rationale} onChange={(e) => setForm((prev) => ({ ...prev, rationale: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[var(--text)]" rows={3} placeholder="Add context, popularity, or why this would be fun" />
            </div>

            <button type="submit" disabled={submitting} className="bg-yellow-500 text-yellow-950 px-5 py-2 rounded-lg font-bold hover:bg-yellow-400 disabled:bg-[var(--surface3)]">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>

          <div className="mt-8 bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
            <h2 className="text-xl font-semibold text-[var(--text)] mb-4">Your Requests</h2>
            {requests.length === 0 ? (
              <p className="text-[var(--text-dim)]">No requests yet.</p>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-[var(--text)]">{request.question}</p>
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${request.status === 'PENDING' ? 'bg-[rgba(217,119,6,0.12)] text-[#f59e0b]' : request.status === 'APPROVED' ? 'bg-[rgba(34,197,94,0.12)] text-[#22c55e]' : 'bg-[rgba(220,38,38,0.12)] text-[var(--red)]'}`}>{request.status}</span>
                    </div>
                    <p className="text-sm text-[var(--text-dim)]">Requested: {request.createdAt?.toDate?.()?.toLocaleDateString() || 'Recently'}</p>
                    {request.adminNotes && <p className="text-sm text-[var(--text-dim)] mt-2"><span className="font-semibold">Admin note:</span> {request.adminNotes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}

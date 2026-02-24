'use client';
import { useEffect, useState } from 'react';
import { auth, db, googleProvider } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { normalizeDisplayName } from '@/utils/displayName';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data()?.onboardingComplete === false) {
          router.push('/onboarding');
          return;
        }
      } catch (error) {
        console.error('Error checking onboarding status:', error);
      }
      router.push('/');
    });
    return () => unsubscribe();
  }, [router]);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError('');

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      if (!user.email?.endsWith('@cornell.edu')) {
        await auth.signOut();
        setError('You must sign in with a Cornell email address (@cornell.edu)');
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      const netId = user.email.split('@')[0];
      const defaultDisplayName = netId;

      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          email: user.email,
          weeklyRep: 1000,
          lifetimeRep: 0,
          oracleScore: 0,
          quickTakesUsedToday: 0,
          quickTakeLastDate: null,
          quickTakeStreak: 0,
          createdAt: new Date(),
          displayName: defaultDisplayName,
          displayNameNormalized: normalizeDisplayName(defaultDisplayName),
          onboardingComplete: false
        });
        router.push('/onboarding');
        return;
      } else {
        const current = userDoc.data() || {};
        const patch = {};
        if (!Number.isFinite(Number(current.weeklyRep))) patch.weeklyRep = 1000;
        if (!Number.isFinite(Number(current.lifetimeRep))) patch.lifetimeRep = 0;
        if (!current.displayName || !current.displayNameNormalized) {
          patch.displayName = current.displayName || defaultDisplayName;
          patch.displayNameNormalized = normalizeDisplayName(patch.displayName);
        }
        if (!current.email && user.email) patch.email = user.email;

        if (Object.keys(patch).length > 0) {
          await setDoc(userDocRef, patch, { merge: true });
        }

        if (current.onboardingComplete === false) {
          router.push('/onboarding');
          return;
        }
      }

      router.push('/');
    } catch (signInError) {
      if (signInError.code === 'auth/popup-closed-by-user') {
        setError('');
        setLoading(false);
        return;
      } else if (signInError.code === 'auth/unauthorized-domain') {
        console.error('Error signing in:', signInError);
        setError('This domain is not authorized. Please contact administrator.');
      } else {
        console.error('Error signing in:', signInError);
        setError('Failed to sign in. Please try again.');
      }

      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="max-w-md w-full">
        <div className="bg-[var(--surface)] rounded-2xl shadow-xl p-8 border border-[var(--border)]">
          <div className="text-center mb-8">
            <h1 className="font-display text-4xl font-bold text-[var(--text)] mb-2">
              Predict <span className="text-[var(--red)]">Cornell</span>
            </h1>
            <p className="text-[var(--text-dim)]">Sign in with your Cornell email</p>
            <p className="text-xs text-yellow-700 font-semibold mt-2">BETA</p>
          </div>

          {error && (
            <div className="mb-6 bg-[var(--surface2)] border border-[var(--red)] rounded-lg p-4">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-300 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-50 hover:border-gray-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <span>Signing in...</span>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Sign in with Cornell Google</span>
              </>
            )}
          </button>

          <div className="mt-6 text-center">
            <p className="text-sm text-[var(--text-dim)]">Must use @cornell.edu email</p>
          </div>

          <div className="mt-8 pt-6 border-t border-[var(--border)]">
            <Link href="/" className="text-sm text-brand-red hover:text-brand-lightpink font-medium block text-center">
              ← Back to markets
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-[var(--text-muted)]">By signing in, you agree to follow Cornell&apos;s code of conduct</p>
        </div>
      </div>
    </div>
  );
}

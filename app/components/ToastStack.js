'use client';

export default function ToastStack({ toasts = [], onDismiss, onConfirm }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-[calc(1rem+var(--safe-bottom))] left-4 right-4 z-[1200] flex flex-col gap-2 md:bottom-auto md:left-auto md:right-5 md:top-5 md:w-[360px] md:max-w-[calc(100vw-24px)]">
      {toasts.map((toast) => {
        const toneClass =
          toast.type === 'success'
            ? 'border-l-green-500'
            : toast.type === 'confirm'
              ? 'border-l-amber-500'
              : 'border-l-brand-red';
        return (
          <div
            key={toast.id}
            className={`toast-fade rounded-md border border-[var(--border)] border-l-[3px] ${toneClass} bg-[var(--surface)] px-4 py-3 font-mono text-[0.75rem] text-[var(--text)] shadow-xl`}
          >
            <p>{toast.message}</p>
            {toast.type === 'confirm' ? (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onConfirm(toast.id, true)}
                  className="rounded bg-[var(--red)] px-3 py-1 text-xs font-semibold text-white"
                >
                  Confirm
                </button>
                <button
                  onClick={() => onConfirm(toast.id, false)}
                  className="rounded border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--text-dim)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => onDismiss(toast.id)}
                className="mt-2 text-xs font-semibold text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                Dismiss
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';

export default function InfoTooltip({ label = 'Info', text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border2)] text-[10px] font-bold text-[var(--text-muted)] hover:border-[var(--text-dim)] hover:text-[var(--text-dim)]"
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-7 z-20 w-64 -translate-x-1/2 rounded-md border border-[var(--border2)] bg-[var(--surface)] p-2 text-xs font-normal text-[var(--text-dim)] shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

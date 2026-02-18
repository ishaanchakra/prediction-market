'use client';
import { useEffect, useRef, useState } from 'react';

export default function InfoTooltip({ label = 'Info', text }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [open]);

  function openTooltip() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const TW = 256; // w-64
    const TH = 100; // generous estimate for tooltip height

    // Center horizontally on button, clamp within viewport
    const left = Math.max(8, Math.min(
      rect.left + rect.width / 2 - TW / 2,
      window.innerWidth - TW - 8
    ));

    // Open above if not enough space below
    const top = window.innerHeight - rect.bottom < TH + 8
      ? rect.top - TH - 6   // above
      : rect.bottom + 6;    // below

    setPos({ top, left });
    setOpen(true);
  }

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={openTooltip}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        onClick={() => { if (open) setOpen(false); else openTooltip(); }}
        className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-[var(--border2)] text-[7px] font-bold text-[var(--text-muted)] hover:border-[var(--text-dim)] hover:text-[var(--text-dim)]"
      >
        i
      </button>
      {open && (
        <span
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[999] w-64 rounded-md border border-[var(--border2)] bg-[var(--surface)] p-2 text-xs font-normal text-[var(--text-dim)] shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

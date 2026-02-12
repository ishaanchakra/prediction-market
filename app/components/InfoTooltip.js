'use client';
import { useState } from 'react';

export default function InfoTooltip({ label = 'Info', text }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] font-bold text-gray-600 hover:bg-gray-100"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-6 z-20 w-64 -translate-x-1/2 rounded-md border border-gray-200 bg-white p-2 text-xs font-normal text-gray-700 shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

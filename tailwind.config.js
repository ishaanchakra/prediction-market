/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['Space Mono', 'monospace'],
        display: ['Instrument Serif', 'serif'],
        sans: ['Syne', 'sans-serif'],
      },
      colors: {
        brand: {
          red: '#DC2626',
          darkred: '#991B1B',
          pink: '#EC4899',
          lightpink: '#F9A8D4',
        },
      },
    },
  },
  plugins: [],
}

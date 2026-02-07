/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#DC2626',      // Main red
          darkred: '#991B1B',  // Dark red
          pink: '#EC4899',     // Accent pink
          lightpink: '#F9A8D4', // Light pink
        },
      },
    },
  },
  plugins: [],
}
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
          carnelian: {
            DEFAULT: '#B31B1B',
            dark: '#8B1414',
            light: '#CC3333',
          },
          cream: '#F7F4EF',
          eggshell: '#FAF8F3',
        },
      },
    },
    plugins: [],
  }
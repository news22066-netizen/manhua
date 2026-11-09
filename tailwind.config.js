/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { accent: { DEFAULT: '#00B4D8', bright: '#00E5FF' } },
      fontFamily: { sans: ['var(--font-poppins)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};

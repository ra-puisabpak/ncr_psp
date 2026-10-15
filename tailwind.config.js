/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sarabun: ['IBM Plex Sans Thai Looped', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

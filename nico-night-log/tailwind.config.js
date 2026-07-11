/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0D1F1C',
        'night-2': '#101a17',
        panel: '#132925',
        'panel-2': '#0F211E',
        slate: '#B7C4BE',
        'slate-dim': '#6E827A',
        teal: '#4A9B82',
        'teal-deep': '#2F6B58',
        amber: '#E8A838',
        'amber-deep': '#A9741F',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
}

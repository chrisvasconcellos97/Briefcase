/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        night: '#0B0F1A',
        'night-2': '#0C1018',
        panel: '#131826',
        'panel-2': '#0F1420',
        slate: '#C9CDD8',
        'slate-dim': '#6E7686',
        cream: '#F3E9DA',
        amber: '#E8A838',
        'amber-deep': '#A9741F',
        rose: '#E0654F',
        sage: '#7CB07C',
        dusk: '#8C9AE8',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"DM Serif Display"', 'serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
}

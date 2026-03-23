/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        hsk: {
          blue: '#0066FF',
          dark: '#0A0E1A',
          surface: '#111827',
          border: '#1F2937',
          text: '#E5E7EB',
          muted: '#6B7280',
          green: '#10B981',
          yellow: '#F59E0B',
          red: '#EF4444',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

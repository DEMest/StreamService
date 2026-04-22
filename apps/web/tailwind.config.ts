import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E54433',
          hover: '#D13D2E',
          muted: 'rgba(229,68,51,0.15)',
        },
        surface: {
          primary: '#0C0C0E',
          elevated: '#161618',
          card: '#1C1C1F',
          overlay: '#222225',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)'],
        mono: ['var(--font-geist-mono)'],
      },
    },
  },
  plugins: [],
};

export default config;

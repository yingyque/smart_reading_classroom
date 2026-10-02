import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        teal: {
          500: '#1C7977',
        },
        violet: {
          500: '#7C3AED',
        },
        ink: {
          900: '#1F2937',
          500: '#5F696E',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 30px rgba(31, 41, 55, 0.08)',
        glass: '0 8px 32px rgba(37, 99, 235, 0.12)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.3s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        ui: ['cwTeXYen', '"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 0 32px rgba(136, 152, 170, 0.12)',
      },
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
          light: 'rgb(var(--color-accent-light) / <alpha-value>)',
          bg: 'rgb(var(--color-accent-bg) / <alpha-value>)',
          'bg-subtle': 'rgb(var(--color-accent-bg-subtle) / <alpha-value>)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        error: 'rgb(var(--color-error) / <alpha-value>)',
        // Override indigo palette to match DESIGN.md primary #5B4FC4
        indigo: {
          50:  '#EDEBF9',
          100: '#E0DCF5',
          200: '#C4BCEB',
          300: '#A89DE1',
          400: '#8C7DD7',
          500: '#5B4FC4',
          600: '#4A3FA3',
          700: '#3A3282',
          800: '#2A2461',
          900: '#1A1740',
          950: '#0D0B20',
        },
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%': { transform: 'translateX(-6px)' },
          '30%': { transform: 'translateX(6px)' },
          '45%': { transform: 'translateX(-4px)' },
          '60%': { transform: 'translateX(4px)' },
          '75%': { transform: 'translateX(-2px)' },
          '90%': { transform: 'translateX(2px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.1)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-up-fade': {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'card-in': {
          '0%': { transform: 'scale(0.85) translateY(8px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'toast-in': {
          '0%': { transform: 'translate(-50%, 20px)', opacity: '0' },
          '100%': { transform: 'translate(-50%, 0)', opacity: '1' },
        },
        'confetti-drop-1': {
          '0%':   { transform: 'translate(0, -10px) rotate(0deg)',   opacity: '1' },
          '100%': { transform: 'translate(-30px, 80px) rotate(240deg)', opacity: '0' },
        },
        'confetti-drop-2': {
          '0%':   { transform: 'translate(0, -10px) rotate(0deg)',   opacity: '1' },
          '100%': { transform: 'translate(25px, 90px) rotate(-180deg)', opacity: '0' },
        },
        'confetti-drop-3': {
          '0%':   { transform: 'translate(0, -10px) rotate(0deg)',   opacity: '1' },
          '100%': { transform: 'translate(40px, 70px) rotate(300deg)', opacity: '0' },
        },
        'star-burst': {
          '0%':   { transform: 'scale(0) rotate(0deg)',   opacity: '1' },
          '50%':  { transform: 'scale(1.4) rotate(180deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(360deg)', opacity: '1' },
        },
        'map-bounce': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        'map-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(var(--tw-glow-color, 99 102 241), 0.4)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(var(--tw-glow-color, 99 102 241), 0)' },
        },
        sparkle: {
          '0%':   { transform: 'scale(0) rotate(0deg)',   opacity: '0' },
          '50%':  { transform: 'scale(1) rotate(180deg)', opacity: '1' },
          '100%': { transform: 'scale(0) rotate(360deg)', opacity: '0' },
        },
      },
      animation: {
        shake: 'shake 0.45s ease-in-out',
        pop: 'pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-up': 'slide-up 0.4s ease-out',
        'slide-up-fast': 'slide-up-fade 0.25s ease-out',
        'card-in': 'card-in 0.3s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out',
        'toast-in': 'toast-in 0.3s ease-out',
        'confetti-drop-1': 'confetti-drop-1 1s ease-in 0.1s forwards',
        'confetti-drop-2': 'confetti-drop-2 1.1s ease-in 0.2s forwards',
        'confetti-drop-3': 'confetti-drop-3 0.9s ease-in 0s forwards',
        'star-burst': 'star-burst 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'map-bounce': 'map-bounce 1.2s ease-in-out infinite',
        'map-glow': 'map-glow 2s ease-in-out infinite',
        sparkle: 'sparkle 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // zhuyin off: 非黑體字型（楷體/明體優先）— 陳淑麗教授：黑體對近視學生不友好
        // cwTeXKai: 台灣教育楷書（Google Fonts），視覺清晰接近教科書手寫感
        // Noto Serif TC: 思源宋體，備援明體（Google Fonts），老眼/近視友好
        // PingFang TC / Microsoft JhengHei: 系統字體備援（macOS/Windows）
        sans: ['cwTeXKai', '"Noto Serif TC"', '"PingFang TC"', '"Microsoft JhengHei"', 'serif'],
        ui: ['cwTeXYen', '"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        headline: ['"Plus Jakarta Sans"', '"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Be Vietnam Pro"', '"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 0 32px rgba(136, 152, 170, 0.12)',
        editorial: '0 12px 48px rgba(48, 47, 42, 0.06)',
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
        // Stitch "Tactile Scholar" surface system
        surface: {
          DEFAULT: '#FBF6EE',
          bright: '#FBF6EE',
          dim: '#D9D4CA',
          'container-lowest': '#FFFFFF',
          'container-low': '#F5F0E8',
          'container': '#ECE8DF',
          'container-high': '#E7E2D8',
          'container-highest': '#E1DCD2',
        },
        'on-surface': {
          DEFAULT: '#302F2A',
          variant: '#5E5B55',
        },
        // Encouragement orange — for corrective feedback (not red)
        tertiary: {
          DEFAULT: '#994100',
          dim: '#863800',
          container: '#FF955A',
          fixed: '#FF955A',
          'fixed-dim': '#FF7F2F',
        },
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
        'fly-away': {
          '0%':   { transform: 'scale(1) translateY(0)',   opacity: '1' },
          '40%':  { transform: 'scale(1.15) translateY(-8px)', opacity: '1' },
          '100%': { transform: 'scale(0.4) translateY(-40px)', opacity: '0' },
        },
        // 多人對抗賽 (#3632 PRD rule N) — six distinct attack styles, each
        // with its own path/rotation signature so a random, never-twice-
        // in-a-row pick is visually obvious, not just a recolor of the
        // same motion. motion-craft skill: no linear easing on any
        // positional move, one thing moving per frame, <=1.5s total.
        'attack-rock': {
          '0%':   { transform: 'translate(-60px, 10px) scale(0.6) rotate(-20deg)', opacity: '0' },
          '15%':  { opacity: '1' },
          '55%':  { transform: 'translate(-10px, -36px) scale(1.05) rotate(80deg)', opacity: '1' },
          '100%': { transform: 'translate(0, 0) scale(1) rotate(160deg)', opacity: '0' },
        },
        'attack-lightning': {
          '0%':   { transform: 'scaleY(0.2) translateY(-50px)', opacity: '0' },
          '20%':  { transform: 'scaleY(1.1) translateY(0)', opacity: '1' },
          '35%':  { opacity: '0.4' },
          '50%':  { opacity: '1' },
          '100%': { transform: 'scaleY(1) translateY(0)', opacity: '0' },
        },
        'attack-fireball': {
          '0%':   { transform: 'translateX(-70px) scale(0.7)', opacity: '0' },
          '20%':  { opacity: '1' },
          '70%':  { transform: 'translateX(0) scale(1.15)', opacity: '1' },
          '100%': { transform: 'translateX(8px) scale(0.9)', opacity: '0' },
        },
        'attack-arrows': {
          '0%':   { transform: 'translateY(-60px) rotate(35deg) scale(0.8)', opacity: '0' },
          '25%':  { opacity: '1' },
          '80%':  { transform: 'translateY(0) rotate(35deg) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(6px) rotate(35deg) scale(0.95)', opacity: '0' },
        },
        'attack-tornado': {
          '0%':   { transform: 'scale(0.3) rotate(0deg)', opacity: '0' },
          '20%':  { opacity: '1' },
          '80%':  { transform: 'scale(1.1) rotate(540deg)', opacity: '1' },
          '100%': { transform: 'scale(0.9) rotate(720deg)', opacity: '0' },
        },
        'attack-meteor': {
          '0%':   { transform: 'translate(-80px, -60px) scale(0.5) rotate(-35deg)', opacity: '0' },
          '20%':  { opacity: '1' },
          '70%':  { transform: 'translate(0, 0) scale(1.1) rotate(-35deg)', opacity: '1' },
          '100%': { transform: 'translate(10px, 10px) scale(0.85) rotate(-35deg)', opacity: '0' },
        },
        'tower-collapse': {
          '0%':   { transform: 'translateY(0) scale(1) rotate(0deg)', opacity: '1' },
          '30%':  { transform: 'translateY(2px) scale(1.03) rotate(-2deg)', opacity: '1' },
          '100%': { transform: 'translateY(18px) scale(0.75) rotate(6deg)', opacity: '0' },
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
        'fly-away': 'fly-away 0.55s cubic-bezier(0.4, 0, 0.6, 1) forwards',
        'attack-rock': 'attack-rock 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'attack-lightning': 'attack-lightning 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'attack-fireball': 'attack-fireball 0.8s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'attack-arrows': 'attack-arrows 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'attack-tornado': 'attack-tornado 1.1s cubic-bezier(0.34, 1.26, 0.64, 1) forwards',
        'attack-meteor': 'attack-meteor 0.9s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'tower-collapse': 'tower-collapse 0.7s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#f3f6f2',
          100: '#e3ebe0',
          200: '#c6d6c1',
          300: '#9ab895',
          400: '#6d956a',
          500: '#4c7749',
          600: '#385d37',
          700: '#243D2E',
          800: '#1c3125',
          900: '#15241b',
          950: '#0d1711',
        },
        sage: {
          50: '#f6f8f5',
          100: '#ebf0ea',
          200: '#d7e1d5',
          300: '#c0cfbc',
          400: '#A6B29B',
          500: '#8c9981',
          600: '#6f7b65',
          700: '#56604e',
          800: '#40473b',
          900: '#2c3128',
        },
        brass: {
          50: '#fbf8f1',
          100: '#f5eee0',
          200: '#ebdcc0',
          300: '#ddc497',
          400: '#B89A64',
          500: '#a38450',
          600: '#84693e',
          700: '#665130',
          800: '#4a3b23',
          900: '#322718',
        },
        olive: {
          50: '#f7f7ee',
          100: '#eeedd4',
          200: '#dcdaab',
          300: '#c4bf7a',
          400: '#aba354',
          500: '#8f8842',
          600: '#6f6b33',
          700: '#54522b',
          800: '#3e3c22',
          900: '#2a2916',
        },
        cream: {
          50: '#FAF7F2',
          100: '#F5F1E8',
          200: '#ede2c6',
          300: '#e1cf9d',
          400: '#d0b46e',
        },
        beige: '#e7dcc4',
        earth: {
          50: '#f8f3ec',
          100: '#efe3d1',
          200: '#dcc4a3',
          300: '#c39f74',
          400: '#a97e52',
          500: '#8a6440',
          600: '#6d4f34',
          700: '#553f2c',
          800: '#3d2d20',
          900: '#291e16',
        },
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'ui-serif', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        eyebrow: '0.28em',
      },
      /**
       * Two opacities the default scale (steps of 5) has no name for.
       *
       * Both exist to keep a hierarchy of hairlines: the signed-in surfaces rule
       * their internal rows at 8% so those rules sit *under* the panel's own 10%
       * border, and dark-mode panel borders sit at 12% so a hairline stays
       * visible against forest-900. Neither value was usable through `@apply`
       * before, which is how the first build of the Guest surfaces failed.
       *
       * Additive: no existing class uses /8 or /12, so nothing already on screen
       * changes.
       */
      opacity: {
        8: '0.08',
        12: '0.12',
      },
      boxShadow: {
        soft: '0 20px 60px -30px rgba(30,49,32,0.35)',
        card: '0 12px 40px -20px rgba(30,49,32,0.25)',
        // Depth shadows for the immersive layer
        depth: '0 30px 80px -30px rgba(15,28,17,0.45), 0 12px 28px -18px rgba(15,28,17,0.35)',
        float: '0 24px 60px -24px rgba(15,28,17,0.55)',
        glow: '0 0 0 1px rgba(251,249,243,0.35), 0 18px 50px -18px rgba(251,249,243,0.55)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0,-6px,0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        kenburns: {
          '0%': { transform: 'scale(1) translate(0,0)' },
          '100%': { transform: 'scale(1.08) translate(-1%, -1%)' },
        }
      },
      animation: {
        'fade-up': 'fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fadeIn 1.2s ease both',
        'kenburns': 'kenburns 18s ease-in-out both',
        'drift': 'drift 7s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}

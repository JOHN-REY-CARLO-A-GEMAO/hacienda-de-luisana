/** @type {import('tailwindcss').Config} */
export default {
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
          700: '#2c4a2d',
          800: '#243b26',
          900: '#1e3120',
          950: '#0f1c11',
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
          50: '#fbf9f3',
          100: '#f6f1e3',
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
      boxShadow: {
        soft: '0 20px 60px -30px rgba(30,49,32,0.35)',
        card: '0 12px 40px -20px rgba(30,49,32,0.25)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
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
      }
    },
  },
  plugins: [],
}

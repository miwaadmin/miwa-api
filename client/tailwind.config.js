/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f0ff',
          100: '#e2e1ff',
          200: '#cac8ff',
          300: '#a9a5ff',
          400: '#8880fb',
          500: '#6f63f7',
          600: '#5746ed',
          700: '#4a38d9',
          800: '#3d2fb5',
          900: '#342c8f',
          950: '#201a5c',
        },
        teal: {
          50:  '#effefa',
          100: '#c9fef2',
          200: '#93fce5',
          300: '#56f4d3',
          400: '#23e2bc',
          500: '#0ac5a2',
          600: '#059e85',
          700: '#077d6a',
          800: '#0a6256',
          900: '#0b5148',
          950: '#013131',
        },
        violet: {
          50:  '#f6f4fe',
          100: '#edeafd',
          200: '#ddd8fb',
          300: '#c3baf8',
          400: '#a593f3',
          500: '#8a6cec',
          600: '#7550e2',
          700: '#633fcf',
          800: '#5234ab',
          900: '#452e8b',
        },
      },
      fontSize: {
        'xs':   ['0.8125rem',  { lineHeight: '1.125rem' }],   // 13px (was 12px)
        'sm':   ['0.9375rem',  { lineHeight: '1.375rem' }],   // 15px (was 14px)
        'base': ['1.0625rem',  { lineHeight: '1.625rem' }],   // 17px (was 16px)
        'lg':   ['1.1875rem',  { lineHeight: '1.8125rem' }],  // 19px (was 18px)
        'xl':   ['1.3125rem',  { lineHeight: '1.875rem' }],   // 21px (was 20px)
        '2xl':  ['1.5625rem',  { lineHeight: '2.125rem' }],   // 25px (was 24px)
        '3xl':  ['1.9375rem',  { lineHeight: '2.375rem' }],   // 31px (was 30px)
        '4xl':  ['2.3125rem',  { lineHeight: '2.5rem' }],     // 37px (was 36px)
        '5xl':  ['3.0625rem',  { lineHeight: '1' }],          // 49px (was 48px)
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #5746ed 0%, #0ac5a2 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #201a5c 0%, #2d2480 100%)',
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)',
        'card-md': '0 4px 12px 0 rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)',
        'card-lg': '0 8px 24px 0 rgba(87,70,237,0.12), 0 2px 6px -2px rgba(0,0,0,0.06)',
        'glow': '0 0 20px rgba(87,70,237,0.25)',
      },
    },
  },
  plugins: [],
}

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1F3864', 50: '#E8ECF4', 900: '#0F1C32' },
        gold: { DEFAULT: '#C9A84C', 50: '#F8F2DE', 900: '#7A6628' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont'],
      },
    },
  },
  plugins: [],
};

export default config;

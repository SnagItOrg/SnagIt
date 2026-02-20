import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
        },
        "dark-bg": "var(--color-dark-bg)",
        "dark-surface": "var(--color-dark-surface)",
      },
    },
  },
  plugins: [],
};

export default config;

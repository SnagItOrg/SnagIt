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
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
          border: "var(--card-border)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          hover: "var(--accent-hover)",
          text: "var(--accent-text)",
          subtle: "var(--accent-subtle)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          hover: "var(--destructive-hover)",
          text: "var(--destructive-text)",
          subtle: "var(--destructive-subtle)",
          border: "var(--destructive-border)",
        },
        border: "var(--border)",
        input: "var(--input-background)",
        ring: "var(--ring)",
        // Visual foundation — surface levels and text ramp
        canvas: "var(--canvas)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          raised: "var(--surface-raised)",
        },
        line: {
          DEFAULT: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        // Legacy aliases
        bg: "var(--background)",
        text: {
          DEFAULT: "var(--foreground)",
          muted: "var(--muted-foreground)",
        },
      },
      boxShadow: {
        card: "var(--elevation-card)",
        raised: "var(--elevation-raised)",
        overlay: "var(--elevation-overlay)",
        rim: "var(--rim)",
      },
      outlineColor: {
        ring: "var(--ring)",
      },
      // Radius scale. Every key maps to the value Tailwind already compiled,
      // so `rounded-lg` / `rounded-xl` / `rounded-2xl` are byte-identical in
      // output and simply route through a token now.
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-base)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        "3xl": "var(--radius-3xl)",
        full: "var(--radius-full)",
      },
      // Two caps, not one: a measure for reading surfaces and a derived,
      // much wider one for card walls. Applied via `.shell-reading` /
      // `.shell-wall` in globals.css; exposed here for one-off use.
      maxWidth: {
        reading: "var(--shell-reading)",
        wall: "var(--shell-wall)",
      },
      spacing: {
        nav: "var(--shell-nav)",
      },
    },
  },
  plugins: [],
};

export default config;

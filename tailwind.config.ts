import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        floral: "#FFFAF0",
        ink: "#2C2925",
        frame: "var(--color-frame)",
        panel: "var(--color-panel)",
        keycap: "var(--color-keycap)",
        legend: "var(--color-legend)",
        highlight: "var(--color-highlight)",
        led: "var(--color-led-status)",
        textMain: "var(--color-text-main)"
      },
      fontFamily: {
        sans: [
          "\"Nunito Sans\"",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "\"Segoe UI\"",
          "sans-serif"
        ],
        mono: [
          "\"Space Mono\"",
          "\"Fira Code\"",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "\"Liberation Mono\"",
          "monospace"
        ]
      },
      boxShadow: {
        float: "0 18px 50px rgba(65, 52, 35, 0.16)"
      }
    }
  },
  plugins: []
} satisfies Config;

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
        ink: "#2C2925"
      },
      boxShadow: {
        float: "0 18px 50px rgba(65, 52, 35, 0.16)"
      }
    }
  },
  plugins: []
} satisfies Config;

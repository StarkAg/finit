/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#050505",
        panel: "#0d0d0d",
        panel2: "#171717",
        line: "#2a2a2a",
        muted: "#9a9a9a",
        brand: "#d8b45a",
        good: "#2dd4bf",
        bad: "#fb7185",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        brand: ["AmericanCaptain", "Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

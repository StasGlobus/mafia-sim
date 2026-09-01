import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        night: "#120e0c",
        paper: "#f3e6cc",
        blood: "#9b2c2c",
        moss: "#3d5a3a",
        dust: "#8a7a64",
        god: "#1c1714",
        ink: "#1a120c",
      },
      fontFamily: {
        heebo: ["var(--font-heebo)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

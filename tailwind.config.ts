import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        night: "#0b0909",
        paper: "#f5ead5",
        blood: "#9b2c2c",
        ember: "#d84a3d",
        moss: "#3d5a3a",
        dust: "#a08f77",
        god: "#1c1714",
        ink: "#1a120c",
      },
      fontFamily: {
        heebo: ["Arial Hebrew", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

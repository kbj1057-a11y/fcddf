import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        pitch: {
          green: "#0f5e2b",
          light: "#8fd694",
          dark: "#062e16",
        },
      },
      spacing: {
        "touch": "48px",
      },
    },
  },
  plugins: [],
};
export default config;

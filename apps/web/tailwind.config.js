/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#5B8B83",
          dark: "#4a736c",
          light: "#e8f2f0",
        },
      },
      keyframes: {
        "teep-orbit": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "teep-orbit": "teep-orbit 2.8s linear infinite",
      },
    },
  },
  plugins: [],
};

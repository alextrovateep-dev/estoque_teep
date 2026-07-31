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
        "teep-spark": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.08)" },
        },
      },
      animation: {
        "teep-spark": "teep-spark 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

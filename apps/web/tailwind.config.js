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
        "teep-indet": {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "teep-orbit": "teep-orbit 2.8s linear infinite",
        "teep-indet": "teep-indet 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

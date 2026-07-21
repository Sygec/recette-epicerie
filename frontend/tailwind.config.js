/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F1EEE4",
        ink: "#2B2A26",
        sage: {
          DEFAULT: "#4B6154",
          dark: "#374A3F",
          light: "#7C9186",
        },
        mustard: {
          DEFAULT: "#C99A3B",
          dark: "#A87D2A",
        },
        brick: {
          DEFAULT: "#A64B3D",
          dark: "#87392D",
        },
        line: "#D8D2C2",
      },
      fontFamily: {
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
  plugins: [],
};

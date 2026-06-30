/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', '"Microsoft YaHei"', "serif"],
        sans: ['"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#1d2218",
        moss: "#4f6842",
        jade: "#7d9b85",
        gold: "#caa96e",
        paper: "#fff7e6",
      },
      boxShadow: {
        soft: "0 30px 90px rgba(31, 43, 24, 0.22)",
      },
    },
  },
  plugins: [],
};

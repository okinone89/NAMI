import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"

import { initialDarkMode } from "./lib/theme"

document.documentElement.classList.toggle("dark", initialDarkMode())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

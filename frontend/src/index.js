import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// No React Query — nothing on the marketing site used it; saves ~5KB+ parse/eval on every load.

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

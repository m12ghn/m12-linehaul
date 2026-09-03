import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyTheme, initialTheme } from "./lib/useTheme";

// Gắn chế độ sáng/tối TRƯỚC khi React vẽ, nếu không màn hình sẽ loé trắng
// một nhịp rồi mới chuyển sang nền đen.
applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

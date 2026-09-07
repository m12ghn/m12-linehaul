import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyTheme, initialTheme } from "./lib/useTheme";

// Gắn chế độ sáng/tối TRƯỚC khi React vẽ, nếu không màn hình sẽ loé trắng
// một nhịp rồi mới chuyển sang nền đen.
applyTheme(initialTheme());

// Xem thử màn đăng nhập GHN·GateFlow: mở /?login (tách chunk riêng -> không
// nặng thêm bundle chính, không đổi luồng đăng nhập hiện tại).
const LoginScreen = lazy(() => import("./components/LoginScreen").then((m) => ({ default: m.LoginScreen })));
const loginPreview = new URLSearchParams(window.location.search).has("login");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {loginPreview ? (
        <Suspense fallback={null}>
          <LoginScreen />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/toast/ToastProvider";
import { IdCardProvider } from "./components/IdCardProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <ToastProvider>
            <IdCardProvider>
                <App />
            </IdCardProvider>
        </ToastProvider>
    </React.StrictMode>
);

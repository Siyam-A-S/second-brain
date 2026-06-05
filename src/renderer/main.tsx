import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { installBrowserApiFallback } from "./lib/browserApiFallback";
import { MainApp } from "./views/MainApp";
import { FloatingWidget } from "./views/FloatingWidget";

installBrowserApiFallback();

const params = new URLSearchParams(window.location.search);
const windowName = params.get("window");
const RootView = windowName === "widget" ? FloatingWidget : MainApp;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootView />
  </React.StrictMode>
);

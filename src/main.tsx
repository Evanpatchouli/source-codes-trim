import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ChakraProvider } from "@chakra-ui/react";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./global.css";

window.addEventListener("DOMContentLoaded", () => {
  getCurrentWebviewWindow().show();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ChakraProvider>
    <App />
    <Toaster />
  </ChakraProvider>
);

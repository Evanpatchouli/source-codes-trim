import ReactDOM from "react-dom/client";
import { ChakraProvider } from "@chakra-ui/react";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ChakraProvider>
    <App />
    <Toaster />
  </ChakraProvider>
);

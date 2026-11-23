import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installChunkReloadHandler } from "./lib/chunkReload";

// A tab open across a deploy asks for chunks that are gone: load the new build.
installChunkReloadHandler();

createRoot(document.getElementById("root")!).render(<App />);

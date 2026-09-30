import { readdirSync } from "node:fs";
import { defineConfig } from "vite";

const iconFiles = readdirSync(new URL("./public/icons/", import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isFile() && /^.+\.(webp|png|jpe?g)$/i.test(entry.name))
  .map(entry => entry.name)
  .sort();

export default defineConfig({
  define: { __ICON_FILES__: JSON.stringify(iconFiles) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/src-tauri/**", "**/data/icon-mapping.json"] } },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13" }
});

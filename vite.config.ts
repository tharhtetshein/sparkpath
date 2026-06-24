import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { aiApi, githubImportApi, jobSearchApi, youtubeSearchApi } from "./server/api";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), jobSearchApi(), youtubeSearchApi(), githubImportApi(env), aiApi(env)],
  };
});

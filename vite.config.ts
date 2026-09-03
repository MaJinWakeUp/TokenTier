import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // The ChatGPT Sites packaging step is a local-only concern: GitHub Pages is
  // the published host, so neither the plugin nor its hosting config is kept in
  // the repository. The path is computed at runtime and marked @vite-ignore so
  // the config bundler never tries to resolve a file that is usually absent.
  const sitesPluginPath = resolve(dirname(fileURLToPath(import.meta.url)), "build/sites-vite-plugin.ts");
  const sitesPlugins: Plugin[] = existsSync(sitesPluginPath)
    ? await import(/* @vite-ignore */ pathToFileURL(sitesPluginPath).href)
        .then((module: { sites: () => Plugin }) => [module.sites()])
        .catch((error: unknown) => {
          console.warn(`Skipping the local Sites plugin: ${String(error)}`);
          return [];
        })
    : [];

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...sitesPlugins,
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});

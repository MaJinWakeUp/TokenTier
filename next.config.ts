import type { NextConfig } from "next";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";

const nextConfig: NextConfig = {
  output: "export",
  // Each route exports as its own directory index, so /recommend/ and
  // /tier-list/ are served by any static host without a rewrite rule.
  trailingSlash: true,
  // In GitHub Actions, if deploying to https://<user>.github.io/<repo>/, prepend /<repo>.
  // If a custom domain is set or running locally, basePath is empty.
  basePath: isGithubActions && repoName && !process.env.CUSTOM_DOMAIN ? `/${repoName}` : "",
  images: {
    unoptimized: true,
  },
  // The lib/ tree uses Node16-style .js extension imports (e.g.
  // "../catalog/types.js") so the compiled output in build/lib resolves
  // correctly under Node16 module resolution. Next.js webpack uses
  // "bundler" resolution, which does not rewrite .js to .ts automatically.
  // extensionAlias maps .js -> .ts so both the CLI (Node16 emitted JS) and
  // Next/Vinext (webpack bundler) resolve the same source files.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "";

const nextConfig: NextConfig = {
  output: "export",
  // In GitHub Actions, if deploying to https://<user>.github.io/<repo>/, prepend /<repo>.
  // If a custom domain is set or running locally, basePath is empty.
  basePath: isGithubActions && repoName && !process.env.CUSTOM_DOMAIN ? `/${repoName}` : "",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;


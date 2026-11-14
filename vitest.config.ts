import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// next-auth imports `next/server`. Node's loader will not resolve that
// extensionless path; Next's bundler will. Inline the package so Vitest
// resolves it the same way, and point the alias at the real file.
const require = createRequire(import.meta.url);
const nextServer = require.resolve("next/server.js", { paths: ["packages/auth"] });

export default defineConfig({
  resolve: {
    alias: {
      "next/server": nextServer,
    },
  },
  ssr: {
    noExternal: ["next-auth"],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
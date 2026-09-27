import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node18",
  banner: ({ entry }) => (entry === "src/cli.ts" ? { js: "#!/usr/bin/env node" } : {}),
});

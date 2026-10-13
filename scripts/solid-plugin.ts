// Compiles Solid JSX in .tsx files with babel-preset-solid, leaving the
// TypeScript for Bun. Bun's own JSX transform targets React, so every bundle
// of site/ goes through this: scripts/build.ts passes it to Bun.build, and
// bunfig.toml registers it for the dev server's HTML imports.

import { transformAsync } from "@babel/core";
import type { BunPlugin } from "bun";

const plugin: BunPlugin = {
  name: "solid",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/u }, async ({ path }) => {
      const out = await transformAsync(await Bun.file(path).text(), {
        filename: path,
        babelrc: false,
        configFile: false,
        presets: [["babel-preset-solid", { generate: "dom" }]],
        plugins: [["@babel/plugin-syntax-typescript", { isTSX: true }]],
      });
      if (out?.code === undefined || out.code === null)
        throw new Error(`babel-preset-solid produced nothing for ${path}`);
      return { contents: out.code, loader: "ts" };
    });
  },
};

export default plugin;

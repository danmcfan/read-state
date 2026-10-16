import { runBatch } from "sandworm";
import config from "./config.ts";

// `bun run sandcastle:batch [issues ...] [--workers N] [--fresh]`; issues are numbers or ranges (`10-20`).
await runBatch(config);

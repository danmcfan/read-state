import { runSingle } from "sandworm";
import config from "./config.ts";

// `bun run sandcastle [issue-number] [--fresh]`. Needs Docker, the image (`bunx sandcastle docker
// build-image`, again after editing the Dockerfile) and .sandcastle/.env (copy .env.example).
await runSingle(config);

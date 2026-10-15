FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  chromium \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Bun runs every repo script; agent-browser drives the page for verify checks.
# Versions match the host's. Chrome for Testing has no Linux ARM64 build, so
# agent-browser uses Debian's Chromium.
RUN npm install -g bun@1.4.2 agent-browser@0.33.2
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

# Go and golangci-lint for the native half of `bun run check`. Versions match the host's and CI's.
ARG GO_VERSION=1.26.4
ARG GOLANGCI_LINT_VERSION=v2.10.1
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-$(dpkg --print-architecture).tar.gz" | tar -C /usr/local -xz \
  && curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b /usr/local/bin ${GOLANGCI_LINT_VERSION}
ENV PATH="/usr/local/go/bin:$PATH"

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Rust (stable, with clippy and rustfmt as in CI), plus the wasm target and wasm-pack for `bun run build:wasm`.
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --component clippy,rustfmt --target wasm32-unknown-unknown \
  && curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | PATH="/home/agent/.cargo/bin:$PATH" sh
ENV PATH="/home/agent/go/bin:/home/agent/.cargo/bin:$PATH"

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]

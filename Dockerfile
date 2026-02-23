FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app
RUN chown node:node /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node ui/package.json ./ui/package.json
# Copy extension package.json files that have external deps (pnpm needs them early)
COPY --chown=node:node extensions/claude-code/package.json ./extensions/claude-code/package.json
COPY --chown=node:node extensions/security-filter/package.json ./extensions/security-filter/package.json
COPY --chown=node:node extensions/gmail-manager/package.json ./extensions/gmail-manager/package.json
COPY --chown=node:node extensions/calendar-manager/package.json ./extensions/calendar-manager/package.json
COPY --chown=node:node extensions/drive-manager/package.json ./extensions/drive-manager/package.json
COPY --chown=node:node extensions/notion-manager/package.json ./extensions/notion-manager/package.json
COPY --chown=node:node extensions/obsidian-manager/package.json ./extensions/obsidian-manager/package.json
COPY --chown=node:node extensions/yt-downloader/package.json ./extensions/yt-downloader/package.json
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts

USER node
RUN pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
USER root
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      mkdir -p /home/node/.cache/ms-playwright && \
      PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node /home/node/.cache/ms-playwright && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

USER node
COPY --chown=node:node . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Install Claude Code CLI (needed by claude-code plugin Agent SDK)
# Install coding agent CLIs (needed by plugin SDKs)
# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Developer tools for coding agents (codex/claude_code use these in sandboxed sessions)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ripgrep \
      jq \
      fd-find \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp + ffmpeg (needed by yt-downloader extension)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk @openai/codex @openai/codex-sdk vercel
# Symlink globally-installed SDKs into /app/node_modules so bundled extension code can resolve them
# (NODE_PATH works for CJS require() but NOT for ESM import(), symlinks work for both)
RUN ln -s /usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk /app/node_modules/@anthropic-ai/claude-agent-sdk \
    && mkdir -p /app/node_modules/@openai \
    && ln -s /usr/local/lib/node_modules/@openai/codex-sdk /app/node_modules/@openai/codex-sdk

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Pre-create writable dirs for Claude Code and Codex CLIs.
# Credential files are bind-mounted read-only at runtime; these dirs
# let the CLIs write session data, caches, and skills.
RUN mkdir -p /home/node/.claude /home/node/.codex \
    && chown -R node:node /home/node/.claude /home/node/.codex


# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]

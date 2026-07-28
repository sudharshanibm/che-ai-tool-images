# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG GEMINI_CLI_VERSION=0.44.0
ARG GEMINI_CLI_COMMIT=1000b33d4caf462b8f34063c8669ebc2ce59dce2
ARG YOGA_LAYOUT_VERSION=3.2.1
ARG YOGA_LAYOUT_COMMIT=042f5013152eb81c1552dec945b88f7b95ca350f
ARG YOGA_LAYOUT_WASM_SHA256=08fe96e91682ced96c8da755984fc772f17ab0ae50ab4f2a8c52b1406fac876b
ARG YOGA_BUILD_PLATFORM=linux/amd64

# Gemini CLI bundles yoga-layout's generated WASM into its published JavaScript.
# yoga-layout 3.2.1 predates react/yoga#1857 and its WASM therefore fails on
# big-endian systems. Rebuild only that generated file with Emscripten's
# SUPPORT_BIG_ENDIAN setting, then use it when rebuilding the Gemini bundle.
#
# Yoga 3.2.1 was originally built with Emscripten 3.1.28. The generated
# JavaScript/WASM is architecture-neutral, so this stage intentionally runs on
# amd64 even when the final image targets s390x or ppc64le.
FROM --platform=$YOGA_BUILD_PLATFORM emscripten/emsdk:3.1.28 AS yoga-builder

ARG YOGA_LAYOUT_VERSION
ARG YOGA_LAYOUT_COMMIT
ARG YOGA_LAYOUT_WASM_SHA256

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "v${YOGA_LAYOUT_VERSION}" \
      https://github.com/facebook/yoga.git && \
    test "$(git -C yoga rev-parse HEAD)" = "${YOGA_LAYOUT_COMMIT}"

COPY yoga-layout-big-endian.patch /tmp/yoga-layout-big-endian.patch
RUN git -C /src/yoga apply --check /tmp/yoga-layout-big-endian.patch && \
    git -C /src/yoga apply /tmp/yoga-layout-big-endian.patch

WORKDIR /src/yoga/javascript
RUN emcmake cmake -S . -B build -G Ninja && \
    cmake --build build --parallel 2 && \
    echo "${YOGA_LAYOUT_WASM_SHA256}  binaries/yoga-wasm-base64-esm.js" \
      | sha256sum --check -

# Rebuild the exact Gemini CLI release after replacing only yoga-layout's
# generated WASM binding. Gemini's release bundle is architecture-neutral.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS gemini-builder

ARG GEMINI_CLI_VERSION
ARG GEMINI_CLI_COMMIT
ARG YOGA_LAYOUT_WASM_SHA256

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "v${GEMINI_CLI_VERSION}" \
      https://github.com/google-gemini/gemini-cli.git && \
    test "$(git -C gemini-cli rev-parse HEAD)" = "${GEMINI_CLI_COMMIT}"

WORKDIR /src/gemini-cli
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

COPY --from=yoga-builder \
  /src/yoga/javascript/binaries/yoga-wasm-base64-esm.js \
  /tmp/yoga-wasm-base64-esm.js

RUN echo "${YOGA_LAYOUT_WASM_SHA256}  /tmp/yoga-wasm-base64-esm.js" \
      | sha256sum --check - && \
    cp /tmp/yoga-wasm-base64-esm.js \
      node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js && \
    npm run bundle && \
    node scripts/prepare-npm-release.js && \
    mkdir -p /out && \
    npm pack \
      --workspace @google/gemini-cli \
      --ignore-scripts \
      --pack-destination /out && \
    mv /out/google-gemini-cli-*.tgz /out/gemini-cli-patched.tgz

# Install the rebuilt Gemini package on a multi-arch Node image so the
# dependency layout and optional packages match the target architecture.
# ubi8/nodejs-22-minimal is used instead of node:22-slim because it supports
# s390x and ppc64le in addition to amd64/arm64.
FROM registry.access.redhat.com/ubi8/nodejs-22-minimal:1-11 AS npm-installer

ARG GEMINI_CLI_VERSION

COPY --from=gemini-builder /out/gemini-cli-patched.tgz /tmp/
COPY verify-yoga.mjs /tmp/verify-yoga.mjs

RUN npm install -g /tmp/gemini-cli-patched.tgz && \
    npm cache clean --force

# Exercise the patched Yoga binding on every target architecture. This RUN is
# executed through QEMU for s390x by the existing multi-arch workflows.
RUN node /tmp/verify-yoga.mjs \
      /opt/app-root/src/.npm-global/lib/node_modules/@google/gemini-cli

# Verify the package and capture its entry-point script.
# npm global prefix on ubi8/nodejs-22-minimal is /opt/app-root/src/.npm-global
RUN which gemini && \
    node -e " \
      const p = require('/opt/app-root/src/.npm-global/lib/node_modules/@google/gemini-cli/package.json'); \
      if (p.version !== '${GEMINI_CLI_VERSION}') throw new Error('Unexpected Gemini CLI version: ' + p.version); \
      const b = p.bin; \
      const entry = typeof b === 'string' ? b : b[Object.keys(b)[0]]; \
      process.stdout.write(entry.replace(/^\.\//, '')); \
    " > /tmp/gemini-entry.txt && \
    echo "Gemini entry point: $(cat /tmp/gemini-entry.txt)"

# Obtain the official Node.js binary from nodejs.org.
# ubi9/nodejs-22 ships node as a dynamically linked binary that requires
# libnode.so.127 — a RHEL-package-specific shared library not present in
# workspace containers. The official upstream tarball is a self-contained
# binary compiled against glibc 2.17, which works on ubi9 (2.34), ubi10
# (2.38+), and any other modern Linux without extra shared libraries.
FROM alpine:3.21 AS node-provider

ARG TARGETARCH
ARG NODE_VERSION=22.16.0

RUN apk add --no-cache curl xz && \
    case "${TARGETARCH}" in \
      amd64) NODE_ARCH="x64" ;; \
      arm64) NODE_ARCH="arm64" ;; \
      s390x) NODE_ARCH="s390x" ;; \
      ppc64le) NODE_ARCH="ppc64le" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
      -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /tmp && \
    cp /tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node /usr/local/bin/node && \
    ls -lh /usr/local/bin/node

# Assemble the final bundle.
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

ARG GEMINI_CLI_VERSION

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=npm-installer /opt/app-root/src/.npm-global/lib/node_modules /opt/gemini-cli/lib/node_modules
COPY --from=node-provider /usr/local/bin/node /opt/gemini-cli/bin/node
COPY --from=npm-installer /tmp/gemini-entry.txt /opt/gemini-cli/gemini-entry.txt

# Wrapper script:
#   - Uses the bundled official Node.js binary (self-contained, glibc 2.17+, no libnode.so).
#   - Resolves the gemini entry point within the bundled node_modules so
#     Node's module resolution finds all dependencies correctly.
#   - Redirects HOME for OpenShift arbitrary UIDs where $HOME is not writable.
RUN GEMINI_ENTRY="$(cat /opt/gemini-cli/gemini-entry.txt)" && \
    printf '#!/bin/sh\n\
REAL_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"\n\
SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"\n\
GEMINI_SCRIPT="$SCRIPT_DIR/../lib/node_modules/@google/gemini-cli/%s"\n\
GEMINI_TMP_HOME="/tmp/gemini-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$GEMINI_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME/.gemini"\n\
test -f "$HOME/.gemini/projects.json" || echo '"'"'{"projects":{}}'"'"' > "$HOME/.gemini/projects.json"\n\
exec "$SCRIPT_DIR/node" "$GEMINI_SCRIPT" "$@"\n' "$GEMINI_ENTRY" > /opt/gemini-cli/bin/gemini && \
    chmod +x /opt/gemini-cli/bin/gemini && \
    rm /opt/gemini-cli/gemini-entry.txt && \
    test "$(/opt/gemini-cli/bin/gemini --version)" = "${GEMINI_CLI_VERSION}"

LABEL org.opencontainers.image.description="Gemini CLI init container for DevWorkspace injection with big-endian Yoga WASM support" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"

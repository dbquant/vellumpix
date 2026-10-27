#!/usr/bin/env bash
# Authenticated Ubuntu/Debian forced-disconnect E2E for PR #327.
# Requires a local ChatGPT cookie export (never commit it):
#   node scripts/export-chatgpt-cookies.mjs /tmp/vellumpix-e2e-cookies.json
#   bash scripts/run-vellumpix-e2e-cdp-disconnect-linux.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COOKIES="${VELLUMPIX_BROWSER_COOKIES_FILE:-/tmp/vellumpix-e2e-cookies.json}"
IMAGE="${VELLUMPIX_LINUX_PROOF_IMAGE:-node:24-bookworm}"

if [[ ! -f "${COOKIES}" ]]; then
  echo "E2E_PROOF_FAILED: missing cookies at ${COOKIES}" >&2
  exit 1
fi

echo "[linux-e2e] image=${IMAGE}"
echo "[linux-e2e] cookies=${COOKIES} (mounted read-only; not copied into the image)"

docker run --rm \
  --name "vellumpix-cdp-linux-e2e-$$" \
  --cap-add=SYS_PTRACE \
  --security-opt seccomp=unconfined \
  -v "${ROOT}:/src:ro" \
  -v "${COOKIES}:/secrets/chatgpt-cookies.json:ro" \
  -w /tmp/vellumpix-e2e \
  -e VELLUMPIX_BROWSER_COOKIES_FILE=/secrets/chatgpt-cookies.json \
  -e VELLUMPIX_E2E_BROWSER_PORT=9344 \
  -e VELLUMPIX_E2E_MODEL_STRATEGY=current \
  -e VELLUMPIX_E2E_HIDE_WINDOW=1 \
  -e VELLUMPIX_CHROME_NO_SANDBOX=1 \
  -e CHROME_PATH=/usr/bin/chromium \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq chromium fonts-liberation ca-certificates gdb lsof xvfb >/tmp/apt.log
    tar -C /src --exclude=node_modules --exclude=dist --exclude=.git -cf - . \
      | tar -C /tmp/vellumpix-e2e -xf -
    corepack enable
    corepack prepare pnpm@10.33.2 --activate
    pnpm install --frozen-lockfile
    pnpm run build
    export HOME=/tmp/vellumpix-home
    mkdir -p "$HOME"
    echo "[linux-e2e] platform=$(uname -sm) chrome=${CHROME_PATH}"
    # Visible Chrome under virtual framebuffer (headless is Cloudflare-blocked).
    xvfb-run -a -s "-screen 0 1280x720x24" \
      node scripts/vellumpix-e2e-cdp-disconnect-proof.mjs
  '

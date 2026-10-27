#!/usr/bin/env bash
set -euo pipefail

: "${VELLUMPIX_HOME_DIR:=$HOME/.vellumpix-local}"
: "${VELLUMPIX_BROWSER_PROFILE_DIR:=$VELLUMPIX_HOME_DIR/browser-profile}"

export VELLUMPIX_HOME_DIR
export VELLUMPIX_BROWSER_PROFILE_DIR

exec vellumpix --engine browser --browser-manual-login --browser-keep-browser "$@"

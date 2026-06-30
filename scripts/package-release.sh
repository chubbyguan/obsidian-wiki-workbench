#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/manifest.json').version")"
RELEASE_DIR="${ROOT_DIR}/dist/release"
ZIP_PATH="${ROOT_DIR}/dist/wiki-workbench-${VERSION}.zip"

rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}" "${ROOT_DIR}/dist"

cp \
  "${ROOT_DIR}/manifest.json" \
  "${ROOT_DIR}/versions.json" \
  "${ROOT_DIR}/main.js" \
  "${ROOT_DIR}/styles.css" \
  "${ROOT_DIR}/dashboard-logic.js" \
  "${ROOT_DIR}/task-logic.js" \
  "${ROOT_DIR}/workbench-derive.js" \
  "${ROOT_DIR}/date-utils.js" \
  "${ROOT_DIR}/README.md" \
  "${ROOT_DIR}/CHANGELOG.md" \
  "${RELEASE_DIR}/"

rm -f "${ZIP_PATH}"
(
  cd "${RELEASE_DIR}"
  zip -qr "${ZIP_PATH}" .
)

echo "Created ${ZIP_PATH}"

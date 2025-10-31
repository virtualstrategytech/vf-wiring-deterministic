#!/usr/bin/env bash
# Wrapper to run Jest in CI and capture full stdout/stderr to a file while
# preserving the exit code. This helps when GitHub Actions truncates logs or
# the inline runner doesn't capture everything.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p tests

echo "--- CI ENV SNAPSHOT ---" > tests/jest-output.txt
env | sort >> tests/jest-output.txt
echo "--- STARTING JEST ---" >> tests/jest-output.txt

# Run jest and tee output to tests/jest-output.txt. Capture jest exit code
# from the pipeline and propagate it as the script exit code.
npx jest --globalSetup=./tests/globalSetup.js --globalTeardown=./tests/globalTeardown.js --runInBand --verbose 2>&1 | tee -a tests/jest-output.txt
EXIT_CODE=${PIPESTATUS[0]:-0}
echo "--- JEST EXIT CODE: $EXIT_CODE ---" >> tests/jest-output.txt
exit "$EXIT_CODE"

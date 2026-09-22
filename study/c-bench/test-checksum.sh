#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p c-bench/build/checksum
g++ -std=c++17 -O2 -fsanitize=undefined c-bench/test-checksum.cpp c-bench/vendor/smhasher/src/MurmurHash3.cpp -o c-bench/build/checksum/test-native
c-bench/build/checksum/test-native
node c-bench/check-checksum.mjs

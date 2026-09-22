#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p c-bench/build/dynamic
g++ -std=c++17 -O2 -c c-bench/vendor/smhasher/src/MurmurHash3.cpp -o c-bench/build/dynamic/murmur-reference.o
g++ -std=c++17 -O2 -g -fsanitize=address,undefined -fno-sanitize-recover=all c-bench/test-dynamic.cpp c-bench/build/dynamic/murmur-reference.o -o c-bench/build/dynamic/test-native
# LeakSanitizer cannot run under this environment's ptrace; ASan/UBSan remain enabled.
ASAN_OPTIONS=detect_leaks=0 c-bench/build/dynamic/test-native
node c-bench/check-dynamic.mjs

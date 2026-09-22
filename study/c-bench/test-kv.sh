#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
g++ -O2 -std=c++17 -Ivendor/iblt test-kv.cpp \
  vendor/iblt/iblt.cpp vendor/iblt/murmurhash3.cpp -o build/test-kv
./build/test-kv | tee results-kv.txt

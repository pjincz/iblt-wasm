.DEFAULT_GOAL := all
ROOT := ../..
OUT := $(ROOT)/build/hash-analysis
EMXX ?= $(EMSDK)/upstream/emscripten/em++
NATIVE_CXX ?= $(EMSDK)/upstream/bin/clang++
EXPORTS := _malloc,_free,_hash32_once,_hash128_once,_index32,_index128,_index32_check,_index128_check,_updates
WASMFLAGS := -O3 -DNDEBUG -std=c++17 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=$(EXPORTS) --profiling-funcs
.PHONY: all
all: $(OUT)/base.mjs $(OUT)/split.mjs $(OUT)/base-native $(OUT)/split-native
$(OUT):
	mkdir -p "$@"
$(OUT)/base.mjs $(OUT)/base.wasm &: kernels.cpp ../hash-indexes/baseline.h Makefile | $(OUT)
	"$(EMXX)" $(WASMFLAGS) kernels.cpp -o $(OUT)/base.mjs
$(OUT)/split.mjs $(OUT)/split.wasm &: kernels.cpp $(ROOT)/build/hash-indexes/dynamic-iblt.h Makefile | $(OUT)
	"$(EMXX)" $(WASMFLAGS) '-DIBLT_HEADER="../../build/hash-indexes/dynamic-iblt.h"' kernels.cpp -o $(OUT)/split.mjs
$(OUT)/base-native: kernels.cpp ../hash-indexes/baseline.h Makefile | $(OUT)
	"$(NATIVE_CXX)" -O3 -DNDEBUG -std=c++17 kernels.cpp -o "$@"
$(OUT)/split-native: kernels.cpp $(ROOT)/build/hash-indexes/dynamic-iblt.h Makefile | $(OUT)
	"$(NATIVE_CXX)" -O3 -DNDEBUG -std=c++17 '-DIBLT_HEADER="../../build/hash-indexes/dynamic-iblt.h"' kernels.cpp -o "$@"

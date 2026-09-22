.DEFAULT_GOAL := all
.DELETE_ON_ERROR:
ROOT := ../..
OUT := $(ROOT)/build/hash-indexes
ifneq ($(strip $(EMSDK)),)
EMXX ?= $(EMSDK)/upstream/emscripten/em++
else
EMXX ?= em++
endif
EXPORTS := _malloc,_free,_dynamic_create,_dynamic_destroy,_dynamic_clone,_dynamic_update,_dynamic_wire_size,_dynamic_serialize,_dynamic_deserialize,_dynamic_decode,_dynamic_result_count,_dynamic_result_keys,_dynamic_result_sides
.PHONY: all
all: $(OUT)/index.mjs $(OUT)/iblt-dynamic.mjs $(OUT)/iblt-dynamic.wasm
$(OUT)/dynamic-iblt.h: baseline.h generate.mjs
	node generate.mjs
$(OUT)/dynamic-wrapper.cpp: baseline-wrapper.cpp | $(OUT)/dynamic-iblt.h
	cp "$<" "$@"
$(OUT)/index.mjs: baseline-bridge.mjs | $(OUT)/dynamic-iblt.h
	cp "$<" "$@"
$(OUT)/iblt-dynamic.mjs $(OUT)/iblt-dynamic.wasm &: $(OUT)/dynamic-wrapper.cpp $(OUT)/dynamic-iblt.h Makefile
	"$(EMXX)" -O3 -DNDEBUG -std=c++17 $(OUT)/dynamic-wrapper.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node,web,worker -sALLOW_MEMORY_GROWTH=1 -sWASM_BIGINT=1 -sASSERTIONS=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=$(EXPORTS) -o $(OUT)/iblt-dynamic.mjs

# Archived pre-migration baseline, independent of current production mapping.
BASE := $(ROOT)/build/hash-indexes-baseline
all: $(BASE)/index.mjs $(BASE)/iblt-dynamic.mjs $(BASE)/iblt-dynamic.wasm
$(BASE):
	mkdir -p "$@"
$(BASE)/dynamic-iblt.h: baseline.h | $(BASE)
	cp "$<" "$@"
$(BASE)/dynamic-wrapper.cpp: baseline-wrapper.cpp | $(BASE)
	cp "$<" "$@"
$(BASE)/index.mjs: baseline-bridge.mjs | $(BASE)
	cp "$<" "$@"
$(BASE)/iblt-dynamic.mjs $(BASE)/iblt-dynamic.wasm &: $(BASE)/dynamic-wrapper.cpp $(BASE)/dynamic-iblt.h Makefile
	"$(EMXX)" -O3 -DNDEBUG -std=c++17 $(BASE)/dynamic-wrapper.cpp -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node,web,worker -sALLOW_MEMORY_GROWTH=1 -sWASM_BIGINT=1 -sASSERTIONS=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=$(EXPORTS) -o $(BASE)/iblt-dynamic.mjs

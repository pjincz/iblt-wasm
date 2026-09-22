#pragma once
#include "platform.h"
/* Minimal platform shim, not an alternative implementation of the IBF/hash. */
#define GNUNET_YES 1
#define GNUNET_NO 0
#define GNUNET_SYSERR (-1)
#define GNUNET_assert(x) do { if (!(x)) abort(); } while (0)
#define GNUNET_new(t) ((t *) calloc(1, sizeof(t)))
#define GNUNET_malloc(n) calloc(1, (n))
#define GNUNET_malloc_large(n) calloc(1, (n))
#define GNUNET_free free
#define GNUNET_memcpy memcpy
struct GNUNET_HashCode { uint64_t bits[8]; };
static inline void *GNUNET_memdup(const void *p, size_t n) {
  void *q = malloc(n);
  if (!q) abort();
  return memcpy(q, p, n);
}
#ifdef __cplusplus
extern "C" {
#endif
int32_t GNUNET_CRYPTO_crc32_n(const void *, size_t);
uint32_t GNUNET_CRYPTO_crc16_step(uint32_t, const void *, size_t);
uint16_t GNUNET_CRYPTO_crc16_finish(uint32_t);
#ifdef __cplusplus
}
#endif

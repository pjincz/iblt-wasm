#include "iblt.h"
using iblt::IBLT;
struct Handle {
    IBLT table;
    std::vector<uint8_t> keys;
    std::vector<int32_t> sides;
    Handle(unsigned cells,unsigned keyBytes,unsigned checkBytes):table(cells,keyBytes,checkBytes){}
};
extern "C" {
Handle *iblt_create(unsigned cells,unsigned keyBytes,unsigned checkBytes) {
    if (!IBLT::valid(cells,keyBytes,checkBytes)) return nullptr;
    return new Handle(cells,keyBytes,checkBytes);
}
void iblt_destroy(Handle *h) { delete h; }
Handle *iblt_clone(Handle *h) { auto *copy=new Handle(h->table.cellCount(),h->table.keyBytes(),h->table.checkBytes());copy->table=h->table;return copy; }
unsigned iblt_wire_size(Handle *h) { return h->table.wireBytes(); }
Handle *iblt_fold(Handle *h,unsigned cells) {
    if (!IBLT::valid(cells,h->table.keyBytes(),h->table.checkBytes()) || h->table.cellCount()%cells) return nullptr;
    auto *out=new Handle(cells,h->table.keyBytes(),h->table.checkBytes());
    if (!h->table.fold(out->table)) { delete out; return nullptr; }
    return out;
}
void iblt_serialize(Handle *h,uint8_t *out) { h->table.serialize(out); }
int iblt_serialize_folded(Handle *h,uint8_t *out,unsigned cells) { return h->table.serialize(out,cells); }
void iblt_deserialize(Handle *h,const uint8_t *in) { h->table.deserialize(in); }
int iblt_update(Handle *h,const uint8_t *keys,unsigned count,int remove) {
    for(unsigned i=0;i<count;++i) if(!h->table.update(keys+size_t(i)*h->table.keyBytes(),remove?-1:1)) return 0;
    return 1;
}
int iblt_decode(Handle *a,Handle *b) {
    a->keys.clear();a->sides.clear();
    auto diff=a->table;
    return diff.subtract(b->table) && diff.peel(a->keys,a->sides);
}
unsigned iblt_result_count(Handle *h) { return h->sides.size(); }
const uint8_t *iblt_result_keys(Handle *h) { return h->keys.data(); }
const int32_t *iblt_result_sides(Handle *h) { return h->sides.data(); }
}

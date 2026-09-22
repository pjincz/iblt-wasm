const {default:createModule}=await import(new URL(`../../build/hash-analysis/prod-${process.argv[2]??'split'}/iblt-dynamic.mjs`,import.meta.url));
const w=await createModule(),ptr=w._malloc(16);w.HEAPU8.fill(1,ptr,ptr+16);
const table=w._dynamic_create(512,16,12);
for(let i=0;i<20000;i++)w._dynamic_update(table,ptr,1,i%2);
w._dynamic_destroy(table);w._free(ptr);

# iblt-wasm

A WebAssembly-powered Invertible Bloom Lookup Table (IBLT) library for efficient set reconciliation in Node.js and browsers.

## 现有实验

历史实现、第三方对照库、测试及 benchmark 结果集中保存在 [study/](study/README.md)，作为独立 npm 项目保留。

- [固定长度 C++ 实现](study/c-bench/key-only-iblt.h)
- [动态长度 C++ 实现](study/c-bench/dynamic-iblt.h)
- [动态版说明与测试结果](study/c-bench/README-dynamic.md)
- [30 万条记录 benchmark](study/c-bench/README-300k.md)

在实验目录执行原有命令：

```sh
cd study
npm run bench:dynamic:check
```

或从仓库根目录执行 `npm --prefix study run bench:dynamic:check`。

根目录已初始化正式 npm 包（`iblt-wasm`）；库的源码、构建和公共 API 尚待实现。发布文件限定在 `dist/`，不包含实验项目。许可证采用 [BSD-3-Clause](LICENSE)。
实验的 `node_modules/`、`c-bench/build/` 和 `c-bench/vendor/` 已一并迁移，但仍由 Git 忽略。
历史结果里的绝对路径保留为当时的运行记录。

`study/` 中的第三方代码保留各自原有许可证。

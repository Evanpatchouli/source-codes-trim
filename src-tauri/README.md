# 源码整理器

## 项目简介

源码整理器是一个用于整理源码的工具，可以将源码中的注释、空行等无关内容去除，使源码更加简洁。可用于申请软件著作权、专利等。

使用的技术栈为`Tauri 2` + `Vite` + `React` + `ChakraUi`。

## 使用方法

1. 选择源码根目录
2. 点击获取文件
3. 点击整理源码
4. 在右侧文本框中查看整理后的源码，文本框右上方会显示行数和复制按钮

包含、排除规则以换行或 `|` 分隔。排除栏优先，同一栏按顺序应用，`!` 反转匹配。以 `/` 开头限定根目录，以 `/` 结尾指定目录。示例：排除 `/target/ | *.ts | !only.ts` 会跳过根目录的 target 文件夹，以及除 only.ts 以外的 .ts 文件。

普通注释的清理支持 JS/JSX、TS/TSX、Rust、Python、C 和 C++。不支持的格式或无法可靠解析的文件保留原文。

## 开源协议

MIT

## 版权所有

© 2024 [Evanpatchouli](https://github.com/Evanpatchouli)

## 鸣谢

- [Tauri](https://v2.tauri.app/)
- [React](https://react.dev/)
- [ChakraUi](https://v2.chakra-ui.com/)
- [Vite](https://vite.dev/)

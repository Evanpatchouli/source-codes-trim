# 源码整理器

![软件截图](https://evan-oss-bucket1.oss-cn-hangzhou.aliyuncs.com/source-coudes-trim/036229dbaafed37f8df694f538b98fc3.png "软件截图")

## 项目简介

源码整理器是一个用于整理源码的工具，可以将源码中的注释、空行等无关内容去除，使源码更加简洁。可用于申请软件著作权、专利等。

使用的技术栈为`Tauri 2` + `Vite` + `React` + `ChakraUi`。

## 使用方法

1. 选择源码根目录
2. 点击获取文件
3. 点击整理源码
4. 在右侧文本框中查看整理后的源码，文本框右上方会显示行数和复制按钮

整理器识别 JavaScript、JSX、TypeScript、TSX、Rust、Python、C 和 C++ 的语法，清除普通注释及可安全去除的空白。字符串内的 URL、多行文字、Python 整除和语法指令会保留。遇到其他格式或无法可靠解析的源码时，保留该文件原文。

## 开源协议

MIT

## 版权所有

© 2024 [Evanpatchouli](https://github.com/Evanpatchouli)

## 鸣谢

- [Tauri](https://v2.tauri.app/)
- [React](https://react.dev/)
- [ChakraUi](https://v2.chakra-ui.com/)
- [Vite](https://vite.dev/)

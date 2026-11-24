---
name: html-viewer
description: 查看、检索与保存工作区 HTML 文件；需要处理 HTML 时按需加载。
---

# HTML 阅读器

用于查看和保存工作区中的 `.html` / `.htm` 文件。

## 何时使用

- 需要读取 HTML 源码时，先打开插件内容页或直接 `read` 资源。
- 需要修改 HTML 时，调用 `html-viewer.save`，参数为 `ref` 与 `content`。

## 命令

- `html-viewer.save`：写回 HTML 内容并通知同一 `ref` 的订阅者。

## 注意

- 不要把 HTML 当作文本直接覆盖未知编码的文件。
- 保存前先确认当前 `ref` 指向工作区内的文件。

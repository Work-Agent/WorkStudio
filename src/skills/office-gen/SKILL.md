---
name: office-gen
description: 生成真正的二进制 Office 文件（pptx 幻灯片 / docx 文档 / xlsx 表格）。当用户要求创建、生成、导出 PPT/演示文稿/幻灯片/Word 文档/Excel 表格/电子表格时使用；create/generate/export pptx, slides, deck, docx, Word, xlsx, Excel, spreadsheet 同样适用。
---

# office-gen：Office 文件生成

用 `office_gen` 工具生成**真正的二进制 OOXML 文件**。

**严禁**用 write 工具直接写 `.pptx` / `.docx` / `.xlsx`——那只会产出打不开的文本假文件。任何 Office 格式的交付物都必须经 `office_gen` 工具生成。

## 用法

调用 `office_gen` 工具，参数：

- `kind`：`pptx`（幻灯片）/ `docx`（文档）/ `xlsx`（表格）
- `output`：输出路径，用用户期望的落盘位置（工作区相对路径或绝对路径）
- `spec`：内容规格对象，格式见下

成功返回 `OK <路径>（N 个部件）`。无需运行任何命令，也不要再用其他工具转换生成的文件。

## spec 格式

### pptx（16:9，标题 + 要点列表版式）

```json
{
  "slides": [
    { "title": "封面标题", "bullets": ["要点一", "要点二"] },
    { "title": "第二页", "bullets": [] }
  ]
}
```

### docx

```json
{
  "paragraphs": [
    { "style": "Title", "text": "文档标题" },
    { "style": "Heading1", "text": "第一章" },
    { "style": "Normal", "text": "正文段落……" }
  ]
}
```

`style` 可选 `Title` / `Heading1` / `Heading2` / `Normal`；字符串项按 `Normal` 处理。

### xlsx

```json
{
  "sheets": [
    {
      "name": "Sheet1",
      "rows": [
        ["名称", "数量"],
        ["苹果", 12],
        ["香蕉", 30]
      ]
    }
  ]
}
```

单元格为字符串或数字，按行写入；多个工作表在 `sheets` 数组里依次排列。

## 生成后

- 文件可直接被 PowerPoint / Keynote / WPS / Word / Excel 打开，也可作为工作区资源用应用内查看器（如「PowerPoint 演示文稿」插件）打开编辑。
- 不要再对生成文件做文本编辑或格式转换。

## 限制

- pptx 为「标题 + 要点」简洁版式，不支持图片、表格页与母版定制。

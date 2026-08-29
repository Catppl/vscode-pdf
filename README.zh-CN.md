# VS Code PDF Viewer 中文使用说明

[English](README.md) | 简体中文

本文件是 `vscode-pdf` 的中文补充说明，主要介绍 0.2.3–0.2.8 版本新增的批注搜索、搜索结果侧栏和 FreeText 样式预设。

原有英文说明正文保持不变。本文件不替代原 README，也不改变扩展的默认 PDF 打开方式。

## 1. 安装与兼容性

### 从 VSIX 安装

1. 打开 VS Code。
2. 打开扩展视图：`Ctrl+Shift+X`（macOS 为 `Cmd+Shift+X`）。
3. 点击右上角 `...`，选择 **从 VSIX 安装...**。
4. 选择 `vscode-pdf-0.2.8-freetext-presets.vsix`。
5. 安装完成后执行 **Developer: Reload Window**，或关闭并重新打开 PDF。

本版本兼容 VS Code `^1.120.0`（即 1.120.0 及以上的兼容 1.x 版本）。扩展基于 PDF.js 6.2.108。

如果安装后仍然看不到新按钮，通常是旧的 Extension Host 或旧的 PDF 标签页仍在运行。请先关闭旧 PDF 标签页，再 Reload Window 后重新打开。

## 2. 普通文档搜索

普通搜索的行为保持 PDF.js 原有逻辑：

1. 打开 PDF。
2. 点击工具栏的查找按钮，或按 `Ctrl+F` / `Cmd+F`。
3. 输入关键词。
4. 使用 **Previous**、**Next** 导航。

在 **Comments only** 未勾选时，搜索的是 PDF 文档正文文本，不搜索批注内容。原有的 Highlight All、Match Case、Match Diacritics 和 Entire Word 行为保持不变。

## 3. Comments only 批注搜索

### 使用步骤

1. 打开 PDF 并打开查找栏。
2. 勾选 **Comments only**。
3. 输入关键词。
4. 使用 **Previous**、**Next**，或按 `Ctrl+G` / `Cmd+G` 前往下一条；按住 `Shift` 前往上一条。
5. 搜索结果会出现在右侧的可滚动结果面板中，点击任意结果可跳转到对应页和批注位置。

结果面板顶部显示当前结果和总数，例如 `1 / 20`。当前匹配词会使用亮黄色标记，批注目标位置也会显示黄色定位框。

### 右侧结果面板

- 面板中的每一行显示页码、批注类型和匹配文本片段。
- 面板内容可以独立滚动。
- 拖动面板左侧的竖向分隔条可以调整宽度。
- 面板打开时，PDF 页面会为右侧面板预留空间并重新居中，不会被结果面板覆盖。
- 点击 **Show results / Hide results** 可以展开或收起结果列表。

### 什么内容会被识别为批注文本

扩展不会只根据 `subtype === "Text"` 判断批注。以下类型只要包含批注内容，都可能被搜索：

- Text / Sticky Note
- Highlight
- Underline
- StrikeOut
- FreeText
- 其他带有批注文本的标记类型

文本读取顺序是：

1. `annotation.richText.str`
2. `annotation.contentsObj.str`

空字符串会忽略，独立的 `Popup` 批注会忽略，以避免同一条批注重复显示。

### 重要边界：正文文本不会混入

Comments only 只搜索批注文本，不搜索正文，也不搜索高亮标记覆盖的正文内容。

例如：

- 正文：`Treatment-emergent adverse events`
- 批注：`Please confirm whether this should be included in TEAE.`

Comments only 搜索 `confirm` 可以找到该批注；搜索 `Treatment-emergent` 不会因为正文出现该短语而返回结果。

### 重要边界：新批注需要保存并重新打开

批注索引来自 `pdfPage.getAnnotations({ intent: "display" })`。因此，刚刚在当前编辑会话中新建的 FreeText 或其他批注，尚未写入 PDF 页面批注数据时，不能保证立即出现在 Comments only 搜索结果中。

推荐流程：

1. 新建或编辑批注。
2. 点击 PDF.js 的 **Save** 保存 PDF。
3. 关闭当前 PDF 标签页。
4. 重新打开保存后的 PDF。
5. 再次进入 Comments only 搜索。

本阶段不实现实时批注索引刷新，也不扫描多个 PDF。

### Comments only 当前支持范围

支持：

- 普通子串搜索
- Match Case
- Previous / Next
- 结果总数和结果列表
- 批注位置跳转

Comments only 模式下，Entire Word、Match Diacritics 和 Highlight All 会被禁用，因为本阶段没有把这些 PDF.js 正文搜索规则扩展到独立的批注索引中。

不支持：

- 正则表达式搜索
- 搜索作者或日期
- 按批注类型筛选
- 搜索批注对应的正文片段
- 跨 PDF 搜索
- 未保存批注的实时索引
- 批注创建、编辑、删除功能的重新设计

## 4. FreeText 四套样式预设

### 工具栏位置

在 PDF.js 的 **Text**（FreeText）工具旁边会显示四个方形 `Aa` 按钮。

每个按钮只用视觉预览表达三种颜色：

- 文字颜色
- 边框颜色
- 背景颜色

按钮中的 `Aa` 大小固定，按钮边框宽度固定，不代表实际 PDF 中的字号或边框宽度。透明背景会显示棋盘格。

### 一键创建 FreeText

1. 点击任意一个 `Aa` 预设按钮。
2. 在 PDF 页面中点击要放置文本框的位置。
3. 输入文字。
4. 点击其他位置，或使用 PDF.js 原有的提交操作结束编辑。
5. 点击 **Save** 保存 PDF。

点击预设会同时应用以下五项属性，并自动激活 FreeText 工具：

- 字体大小 `fontSize`
- 字体颜色 `fontColor`
- 边框宽度 `borderWidth`
- 边框颜色 `borderColor`
- 背景填充 `backgroundColor`

不需要先点击 Text 再选择预设。

### 默认四套预设

| 预设 | 字体大小 | 字体颜色 | 边框宽度 | 边框颜色 | 背景 |
| --- | ---: | --- | ---: | --- | --- |
| Preset 1 | 10 | `#000000` | 1 | `#FF0000` | `#FFFFFF` |
| Preset 2 | 10 | `#FF0000` | 1 | `#0066FF` | `#FFFF99` |
| Preset 3 | 10 | `#0000FF` | 1 | `#0000FF` | `#EAF3FF` |
| Preset 4 | 10 | `#000000` | 0 | `#000000` | 透明 |

### 编辑预设

对某个 `Aa` 按钮右键，可以打开 **Edit FreeText Preset**。键盘用户也可以聚焦按钮后按 `Shift+F10` 或 Context Menu 键。

编辑器支持：

- Name
- Font size
- Font color
- Border width
- Border color
- Background
- No background fill

点击 **Save** 后：

1. 校验并规范化输入。
2. 保存到 VS Code Global Configuration。
3. 立即刷新按钮预览和 Tooltip。
4. 如果该预设当前处于 active 状态，同步更新当前 FreeText 默认样式。

### 参数限制

- `fontSize`：5–100
- `borderWidth`：0–10；`0` 表示无边框
- `fontColor`：只接受 `#RRGGBB`
- `borderColor`：只接受 `#RRGGBB`
- `backgroundColor`：`#RRGGBB` 或 `null`
- 颜色保存时会统一转换为大写，例如 `#ff0000` 保存为 `#FF0000`
- `backgroundColor: null` 表示透明背景，不是白色背景

无效字段会回退到该字段原来的值，不会让整个预设系统失效。界面始终显示四套预设；缺失的预设会用默认值补齐，超过四项时只使用前四项。

### 通过 VS Code Settings 配置

设置名称为：

```json
"pdf.freeTextPresets"
```

也可以直接在 `settings.json` 中配置，例如：

```json
{
  "pdf.freeTextPresets": [
    {
      "name": "Preset 1",
      "fontSize": 10,
      "fontColor": "#000000",
      "borderWidth": 1,
      "borderColor": "#FF0000",
      "backgroundColor": "#FFFFFF"
    },
    {
      "name": "Preset 2",
      "fontSize": 10,
      "fontColor": "#FF0000",
      "borderWidth": 1,
      "borderColor": "#0066FF",
      "backgroundColor": "#FFFF99"
    },
    {
      "name": "Preset 3",
      "fontSize": 10,
      "fontColor": "#0000FF",
      "borderWidth": 1,
      "borderColor": "#0000FF",
      "backgroundColor": "#EAF3FF"
    },
    {
      "name": "Preset 4",
      "fontSize": 10,
      "fontColor": "#000000",
      "borderWidth": 0,
      "borderColor": "#000000",
      "backgroundColor": null
    }
  ]
}
```

实际使用时，更推荐通过 Aa 按钮右键编辑，避免手写 JSON 时出现颜色格式或数值范围错误。

### Active 状态

当前样式与某套预设的五项属性完全一致时，该按钮会显示外部 focus ring。外框不会改变预设本身的业务边框颜色。

如果用户手动修改字号、字体颜色或其他 FreeText 参数，只要五项属性不再完全相同，对应预设就会取消 active 状态。

## 5. FreeText 保存与兼容性边界

FreeText 的文字、字号、字体颜色、边框宽度、边框颜色和背景填充会写入 PDF annotation data 及 appearance stream，不是只依赖 Webview CSS。

其中四种组合都支持：

- 有背景 + 有边框
- 有背景 + 无边框
- 透明背景 + 有边框
- 透明背景 + 无边框

创建后必须点击 **Save**，然后建议关闭并重新打开 PDF 检查结果。重新打开后应恢复全部五项属性。

本项目已用 PDF.js 重开和独立 PDF 渲染检查过保存结果；Adobe Acrobat 仍建议在目标机器上进行最终人工兼容性验收。

缩放不会把屏幕 CSS 像素直接当作 PDF 边框单位。预设预览和 PDF 中真实的字号/边框宽度是两套单位。

## 6. 推荐验收流程

### 批注搜索

1. 打开含有 Sticky Note、Highlight 或 FreeText 批注的 PDF。
2. 确认普通搜索可以搜索正文。
3. 勾选 Comments only。
4. 搜索已保存的批注短语。
5. 确认正文中相同但批注中不存在的短语不会返回。
6. 检查 `1 / N` 计数、Next、Previous、右侧结果列表和页面跳转。

### FreeText 预设

1. 点击 Preset 2。
2. 新建一条 FreeText。
3. 确认显示为红字、蓝框、黄底。
4. 保存并重新打开 PDF。
5. 确认样式仍然存在。
6. 修改 Preset 2 后关闭并重启 VS Code，确认按钮预览和配置仍然保留。

## 7. 本阶段明确不做的事情

本次更新不包含：

- 批注侧边栏管理器
- 跨 PDF 拖拽或复制批注
- 实时 Comments only 索引刷新
- 搜索作者、日期或批注类型过滤器
- 正则搜索
- Highlight、Ink、Stamp 预设
- 批注模板库
- PDF 保存架构或 CustomEditorProvider 的重构
- 批注导出、数据库或缓存

如果未来要支持“新建批注后立即搜索”，需要单独增加 annotation changed 监听和增量索引失效机制，不应把它与当前预设功能混合实现。

## 8. 常见问题

### 安装后仍是旧界面

关闭旧 PDF 标签页，执行 **Developer: Reload Window**，确认已安装 `mathematic.vscode-pdf` 0.2.8，再重新打开 PDF。

### Comments only 显示 `0 / 0`

先确认 PDF 已经加载完成，再确认批注已经保存到文件并重新打开。只存在于当前编辑会话中的新批注不会立即进入索引。

### 搜不到正文里的词

确认是否勾选了 Comments only。勾选后只搜索批注文本；取消勾选即可恢复正文搜索。

### 预设按钮显示了，但新文本框样式不对

请保存 PDF 后重新打开检查。如果 PDF.js 页面内正确而其他 PDF 阅读器不正确，应收集保存后的 PDF 文件进行兼容性分析；不要仅通过修改 CSS 判断保存功能正确。

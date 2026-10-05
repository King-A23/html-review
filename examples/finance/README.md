# 金融研究页面测试样例

`index.html` 是一个不依赖网络、可通过 `file://` 直接打开的虚构金融研究页面。所有名称、价格、指标与结论均为模拟数据，只用于验证 HTML 批注功能。

## 稳定测试选择器

| 场景 | 选择器 / ID |
| --- | --- |
| 全页批注 | `body`、`#page-header`、`#page-footer` |
| 跨行、跨内联标签的文字 | `#cross-line-copy` |
| 重复文案消歧 | `#duplicate-copy-a`、`#duplicate-copy-b` |
| 数值卡片与父级网格 | `#kpi-nav`、`#kpi-return`、`#kpi-grid` |
| 嵌入式 SVG 图表 | `#performance-chart` |
| CSS 圆环图 | `#allocation-donut` |
| 图片及图注 | `#market-image`、`#market-image-caption`、`#research-image` |
| 多层嵌套卡片 | `#research-featured-card`、`#allocation-note` |
| 空白可点区域 | `#research-empty-space` |
| 表格与指定行 | `#holdings-table`、`#holding-a` 至 `#holding-d` |
| 动态按钮/计数 | `#watch-button`、`#watch-count` |
| 筛选和显示/隐藏 | `#filter-button`、`#allocation-toggle` |
| 表单交互 | `#review-form`、`#topic-input`、`#priority-select`、`#form-message` |

## 包含的场景

- 中文、英文、数值、百分比、emoji 及重复文本；
- 锚点导航、响应式双栏/单栏布局；
- 表格、SVG 折线图、CSS 饼图、data URI SVG 图片和图片图注；
- 按钮计数、筛选、显示/隐藏及模拟表单提交；
- 适合选择文字、元素、空白区域、卡片父级、图表和整页进行批注。

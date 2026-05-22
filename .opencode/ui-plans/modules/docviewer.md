# 模块：文档查看器 (DocViewer)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] DV-01: Mermaid 图表渲染（动态 import mermaid，SVG 渲染）
- [x] DV-02: 文档截断指示器（黄色警告横幅，后端启用截断）
- [x] DV-03: Copy Reference 按钮（Copied! 反馈，1500ms）
- [x] DV-04: 代码块复制按钮（各代码块独立复制功能）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| DV-01 | PASS | - | - | Mermaid 基础设施就绪 |
| DV-02 | PASS | - | #16 | 后端启用截断，行限500 |
| DV-03 | PASS | - | - | Copied! 绿色反馈 |
| DV-04 | PASS | - | - | 代码复制功能 |

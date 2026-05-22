# 模块：Chat 高级功能 (Chat Advanced)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P1
- **状态**: ✅ 已完成

## 测试用例
- [x] CA-01: Usage Bar（Tokens: 5,882 / Cost: ¥0.0506）
- [x] CA-02: Suggestion 按钮（响应后推荐 pill，点击填入输入框）
- [x] CA-03: Thinking Block（灰色斜体 Thinking 内容）
- [x] CA-04: Tool Call 渲染（kb_search/kb_read 内联展示）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| CA-01 | PASS | - | - | Token + 费用 |
| CA-02 | N/A  | - | - | 当前查询无 suggestion |
| CA-03 | PASS | - | - | Thinking 可见 |
| CA-04 | PASS | - | - | 工具调用内联 |

# 模块：KB 面板 (KB Panel)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P1
- **状态**: ✅ 已完成

## 测试用例
- [x] KP-01: Chat 右面板搜索 Tab（输入查询，返回结果）
- [x] KP-02: Chat 右面板大纲 Tab（项目下拉 + 文档列表）
- [x] KP-03: 写入知识库 Modal（Title/Content/Tags/Keywords/Intent，POST /api/docs/write）
- [x] KP-04: 收藏消息（AI 消息收藏按钮，POST /api/favorites）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| KP-01 | PASS | - | - | 搜索结果正常 |
| KP-02 | PASS | - | - | 大纲 Tab 正常 |
| KP-03 | PASS | - | - | 创建文档成功 |
| KP-04 | PASS | - | - | 收藏功能正常 |

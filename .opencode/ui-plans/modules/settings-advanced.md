# 模块：设置高级功能 (Settings Advanced)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P2
- **状态**: ✅ 已完成

## 测试用例
- [x] SX-01: XBrowser 引擎多选标签（Bing/Google/Baidu/DuckDuckGo toggle）
- [x] SX-02: 搜索权重滑块（Combined 模式，Token/TF-IDF/Semantic）
- [x] SX-03: LLM Direct 配置（Toggle ON 显示字段，输入 Model）
- [x] SX-04: Skill Paths 增删（Add/Remove Tag，PUT /api/skills/paths）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| SX-01 | PASS | - | - | 引擎 Tag 切换 |
| SX-02 | PASS | - | - | 三权重滑块 |
| SX-03 | PASS | - | - | LLM Direct 字段 |
| SX-04 | PASS | - | - | Skill 路径 CRUD |

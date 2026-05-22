# 模块：会话高级功能 (Session Advanced)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P1
- **状态**: ✅ 已完成

## 测试用例
- [x] SA-01: 双击重命名会话（PUT /api/sessions/:id/rename 200）
- [x] SA-02: 收藏/取消收藏会话（POST /api/session-favorites，黄色星标）
- [x] SA-03: 分享会话（复制分享链接，toast 提示）
- [x] SA-04: 收藏会话排序优先（星标会话在列表顶部）

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| SA-01 | PASS | - | - | 双击编辑，Enter 提交 |
| SA-02 | PASS | - | - | 星标切换 |
| SA-03 | PASS | - | - | 剪贴板 + toast |
| SA-04 | PASS | - | - | 收藏排序第一 |

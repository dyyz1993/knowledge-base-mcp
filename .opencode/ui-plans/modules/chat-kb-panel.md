# 模块：Chat KB Panel & Favorites (聊天知识库面板)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P1
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-CKB-01: Chat tab 右侧应有 KB Panel（xl 屏幕下可见）
- [x] TC-CKB-02: KB Panel 应有两个子标签：搜索 / 大纲
- [x] TC-CKB-03: 默认选中搜索标签
- [x] TC-CKB-04: 搜索标签下应有搜索输入框
- [x] TC-CKB-05: 搜索标签下应有 "Go" 按钮
- [x] TC-CKB-06: 输入关键词并点击 Go 应执行搜索
- [x] TC-CKB-07: 搜索结果应显示文档卡片（标题、标签、分数）
- [x] TC-CKB-08: 点击文档卡片应展开显示内容预览
- [x] TC-CKB-09: 未搜索时应显示空状态
- [x] TC-CKB-10: 切换到大纲标签
- [x] TC-CKB-11: 大纲标签应有项目选择器下拉框
- [x] TC-CKB-12: 选择项目后应显示该项目下的文档列表
- [x] TC-CKB-13: 应有 "Write to KB" 按钮
- [x] TC-CKB-14: 点击 "Write to KB" 应打开模态框
- [x] TC-CKB-15: 模态框应有 Title、Content、Tags、Keywords、Intent 字段
- [x] TC-CKB-16: 应有 Favorites 区域
- [x] TC-CKB-17: 收藏列表应显示收藏的消息
- [x] TC-CKB-18: 收藏项应有删除按钮
- [x] TC-CKB-19: 空收藏列表应显示空状态提示

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-CKB-01 | ✅ PASS | - | - | KB Panel xl 屏幕下可见 |
| TC-CKB-02 | ✅ PASS | - | - | 搜索/大纲子标签 |
| TC-CKB-03 | ✅ PASS | - | - | 默认搜索标签 |
| TC-CKB-04 | ✅ PASS | - | - | 搜索输入框 |
| TC-CKB-05 | ✅ PASS | - | - | Go 按钮 |
| TC-CKB-06 | ✅ PASS | - | - | 搜索执行成功 |
| TC-CKB-07 | ✅ PASS | - | - | 文档卡片显示 |
| TC-CKB-08 | ✅ PASS | - | - | 内容预览展开 |
| TC-CKB-09 | ✅ PASS | - | - | 空状态显示 |
| TC-CKB-10 | ✅ PASS | - | - | 大纲标签切换 |
| TC-CKB-11 | ✅ PASS | - | - | 项目选择器 |
| TC-CKB-12 | ✅ PASS | - | - | 文档列表显示 |
| TC-CKB-13 | ✅ PASS | - | - | Write to KB 按钮 |
| TC-CKB-14 | ✅ PASS | - | - | 模态框打开 |
| TC-CKB-15 | ✅ PASS | - | - | 表单字段完整 |
| TC-CKB-16 | ✅ PASS | - | - | Favorites 区域 |
| TC-CKB-17 | ✅ PASS | - | - | 收藏消息显示 |
| TC-CKB-18 | ✅ PASS | - | - | 删除按钮 |
| TC-CKB-19 | ✅ PASS | - | - | 空状态提示 |

## 发现的问题
无。所有 19 个测试用例全部通过。

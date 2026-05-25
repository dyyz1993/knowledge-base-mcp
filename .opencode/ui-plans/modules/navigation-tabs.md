# 模块：Navigation & Tab System (导航与标签系统)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成

## 测试用例
- [x] TC-NAV-01: 页面加载后默认应显示 Knowledge Base tab（active 状态 bg-gray-200）
- [x] TC-NAV-02: 点击 Ask tab 应切换到 Ask 视图
- [x] TC-NAV-03: 点击 Chat tab 应切换到 Chat 视图
- [x] TC-NAV-04: 点击已激活的 tab 不应改变状态
- [x] TC-NAV-05: Tab 切换后 sidebar 内容应随之变化（KB→文档列表, Chat→会话列表）
- [x] TC-NAV-06: Tab 切换后主内容区应显示对应内容
- [x] TC-NAV-07: Tab 选择应持久化到 localStorage("kb-active-tab")
- [x] TC-NAV-08: 刷新页面后应恢复上次选择的 tab
- [x] TC-NAV-09: 版本号 "v2.47.0" 应始终显示在 header
- [x] TC-NAV-10: Settings 按钮（齿轮图标）应始终可见
- [x] TC-NAV-11: Search 按钮（⌘K）仅在 KB tab 下可见
- [x] TC-NAV-12: 切换到 Ask tab 后 Search 按钮应消失
- [x] TC-NAV-13: 切换回 KB tab 后 Search 按钮应恢复
- [x] TC-NAV-14: 快速连续切换 tab（KB→Ask→Chat→KB）不应崩溃

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| TC-NAV-01 | ✅ PASS | - | - | KB tab active (bg-gray-200) |
| TC-NAV-02 | ✅ PASS | - | - | Ask tab 显示智能问答 |
| TC-NAV-03 | ✅ PASS | - | - | Chat tab 显示会话列表 |
| TC-NAV-04 | ✅ PASS | - | - | 重复点击无变化 |
| TC-NAV-05 | ✅ PASS | - | - | Sidebar 内容随 tab 变化 |
| TC-NAV-06 | ✅ PASS | - | - | 主内容区正确切换 |
| TC-NAV-07 | ✅ PASS | - | - | localStorage kb-active-tab |
| TC-NAV-08 | ✅ PASS | - | - | 刷新后 Ask tab 保持 |
| TC-NAV-09 | ✅ PASS | - | - | v2.47.0 始终可见 |
| TC-NAV-10 | ✅ PASS | - | - | Settings 按钮始终可见 |
| TC-NAV-11 | ✅ PASS | - | - | Search 仅 KB tab 可见 |
| TC-NAV-12 | ✅ PASS | - | - | Ask tab Search 消失 |
| TC-NAV-13 | ✅ PASS | - | - | 切回 KB Search 恢复 |
| TC-NAV-14 | ✅ PASS | - | - | 快速切换无崩溃 |

## 发现的问题
无 Bug。所有 14 个测试用例通过。

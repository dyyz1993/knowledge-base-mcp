# 模块：搜索功能 (Search)

## 信息
- **URL**: http://localhost:19877
- **优先级**: P0
- **状态**: ✅ 已完成（修复后）

## 测试用例
- [x] SR-01: 点击搜索按钮打开 SearchPalette
- [x] SR-02: SearchPalette 显示搜索输入框
- [x] SR-03: 输入关键词后实时搜索返回结果（**已修复 Bug**）
- [x] SR-04: 点击搜索结果跳转到对应文档
- [x] SR-05: 关闭 SearchPalette（点 X 或点背景）
- [x] SR-06: 空搜索关键词不报错

## 执行记录
| 用例 | 状态 | 耗时 | Bug | 备注 |
|------|------|------|-----|------|
| SR-01 | PASS | - | - | SearchPalette 打开 |
| SR-02 | PASS | - | - | 输入框聚焦 |
| SR-03 | PASS | - | #1 | 搜索 API 响应解析已修复 |
| SR-04 | PASS | - | - | 结果跳转 |
| SR-05 | PASS | - | - | 关闭正常 |
| SR-06 | PASS | - | - | 空搜索不报错 |

## 发现的 Bug
### Bug #1: 搜索结果始终为空（已修复）
- **根因**: API 返回扁平数组 `[{...}]`，前端 `docs.ts:42` 用 `res.documents` 解析（undefined）
- **修复**: `Array.isArray(res) ? res : res.documents || []`

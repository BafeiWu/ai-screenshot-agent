<!--
 * @Author: wuxiaowen 13315692431@163.com
 * @Date: 2026-05-18 10:46:53
 * @LastEditors: wuxiaowen 13315692431@163.com
 * @LastEditTime: 2026-05-18 12:02:41
 * @FilePath: \豆包截图\SPEC.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# 豆包截图工具 - 规格说明书

## 1. 项目概述

**项目名称**：豆包截图 (Doubao Screenshot Tool)

**核心功能**：全局快捷键截图 + 自动上传豆包多模态 AI 解析 + 右侧悬浮面板实时展示结果。

**解决的问题**：用户截图后需要手动切换浏览器、复制粘贴图片、发起搜索的繁琐操作，实现"所见即搜"。

## 2. 技术栈

- 桌面框架: Electron 28+
- 前端框架: Vue3 + Composition API
- 构建工具: Vite
- 截图能力: Electron desktopCapturer
- AI 对接: 豆包多模态 API
- 状态管理: Pinia
- 打包工具: electron-builder

## 3. 功能列表

### 核心功能
- 全局截图快捷键 (默认 Alt+S)
- 全屏截图 (Ctrl+Alt+F)
- 窗口截图 (Ctrl+Alt+W)
- 自动上传 AI
- 右侧悬浮面板

### 系统集成
- 系统托盘常驻
- 开机自启
- 快捷键自定义

### 交互功能
- 多轮对话
- 历史记录
- 面板控制 (拖拽、最小化、关闭、透明度)

## 4. UI/UX 设计

### 右侧悬浮面板规格
- 位置: 固定屏幕右侧，距右边缘 20px
- 尺寸: 宽度 380px，高度自适应
- 样式: 圆角 12px，半透明背景，阴影

### 视觉风格
- 深色主题 (#1a1a2e 背景, #16213e 卡片, #e94560 强调色)

## 5. 验收标准
- 全局快捷键触发截图
- 截图自动上传并获取 AI 解析结果
- 结果在右侧悬浮面板展示
- 面板可拖拽、最小化、关闭
- 系统托盘常驻运行
- 可打包为 .exe 文件

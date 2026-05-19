<!--
 * @Author: wuxiaowen 13315692431@163.com
 * @Date: 2026-05-19 17:49:26
 * @LastEditors: wuxiaowen 13315692431@163.com
 * @LastEditTime: 2026-05-19 18:41:52
 * @FilePath: \豆包截图\README.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
-->
# AI Screenshot Agent

Open-source Electron-based AI screenshot tool. No built-in LLM; users configure their own API keys and choose models freely.

## Tech Stack | 技术栈

- **Frontend**: Vue 3 + TypeScript + Vite
- **Desktop Framework**: Electron 28
- **State Management**: Pinia
- **Data Storage**: electron-store
- **Auto Update**: electron-updater
- **Logging**: electron-log

## Quick Start | 快速开始

### Prerequisites | 环境要求

- Node.js >= 18
- npm or yarn

### Installation | 安装依赖

```bash
npm install
```

### Development | 开发模式

```bash
npm run electron:dev
```

### Build | 构建

```bash
npm run electron:build
```

Output will be in `release/` directory.

## Features | 功能

- Global screenshot capture (full screen, region, window)
- AI-powered image analysis
- Customizable hotkeys
- Auto-update support
- Cross-vendor model support (configurable API endpoint)

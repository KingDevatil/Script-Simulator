# 剧本模拟器 Script Simulator

> LLM 驱动的交互式剧本模拟工具 — 编写规则，AI 演绎故事。

🌐 **在线访问**  
- [script-simulator.pages.dev](https://script-simulator.pages.dev)（Cloudflare Pages）  
- [kingdevatil.github.io/Script-Simulator](https://kingdevatil.github.io/Script-Simulator/)（GitHub Pages）

---

## 什么是剧本模拟器

Script Simulator 是一个**纯前端静态网页应用**。你可以导入或编写一份剧本 JSON（定义角色、数值维度、事件、阶段、结局等规则），然后接入你自己的大语言模型（LLM）API，让 AI 根据剧本规则实时生成剧情、选项和数值变化。

它更像是「给 AI 一套游戏规则，让 AI 当 DM（地下城城主）来跑团」，而不是传统的分支叙事引擎或聊天机器人。

---

## 数据隐私

**所有数据完全存储在浏览器本地（IndexedDB），不经过任何服务器。**

- 你的 API Key 存在浏览器本地存储中
- 对话记录、剧本数据均保存在你的设备上
- 没有任何远程服务器读取、收集或上传你的数据
- 项目本身是一个静态 HTML 文件，部署只是让它能被访问

---

## 编写剧本

如果你想自己写剧本，请阅读 →

📖 **[剧本编写指南](https://github.com/KingDevatil/Script-Simulator/blob/main/docs/script-guide.md)**

---

## 本地开发

```bash
# 安装依赖
npm install

# 构建（输出到 docs/ 目录）
npm run build

# 代码检查
npm run lint

# 运行测试
npm run test

# 完整检查
npm run check
```

构建产物 `docs/index.html` 是一个自包含的单文件应用，可以直接在浏览器打开。

---

## 技术栈

- 纯静态前端，无服务端依赖
- esbuild 打包
- IndexedDB 本地存储
- PWA 支持（可安装到桌面）
- OpenAI 兼容的 LLM API 接口

# StudyHelp 考研智能学习工作台

StudyHelp 是一个面向考研复习的浏览器学习工作台。上传题目或学习资料后，可以通过自选 AI 模型完成分析、解题、作文批改和内容导出。

## 在线使用

访问地址：[https://kekeyo.github.io/studyhelp/](https://kekeyo.github.io/studyhelp/)

首次使用时，点击右上角 **AI Provider Settings**，选择服务商并填写自己的 API Key。GitHub Pages 版本不会附带项目作者的 API Key。

## 功能

- **信号与系统**：题目识别、步骤分析与公式化解答。
- **数学一**：考研数学题目分析和解题过程生成。
- **英语一**：作文识别、批改、评价与高分版本重写。
- 支持图片及 PDF 等学习材料。
- 支持 Markdown、数学公式渲染，以及 TXT/PDF 导出。
- 支持流式输出、响应状态和 Token 用量估算。

## 支持的 AI 服务

GitHub Pages 在线版支持用户在浏览器中配置：

- Google Gemini API
- OpenAI
- DeepSeek
- OpenRouter
- Anthropic Claude
- OpenAI-compatible 自定义接口

不同服务商可能存在浏览器跨域限制。如果某个接口拒绝浏览器直连，需要改用服务商允许的接口或自行部署安全后端。

### API Key 安全说明

API Key 保存在当前站点的浏览器 `localStorage` 中，不会写入源码或提交到 GitHub，但这不等同于服务端密钥保险库：

- 不要在公共或共享设备上保存 API Key。
- 使用完毕后可在浏览器设置中清除该站点的数据。
- 请为 Key 设置额度、来源或权限限制，并定期轮换。
- 不要把 Key 写进 `.env.example`、源码、Issue 或提交记录。

## 本地运行

需要 Node.js 22 或兼容版本。

```bash
npm install
npm run dev
```

默认会同时启动 Vite 前端和 Node 后端。前端通常位于 `http://localhost:5173`，后端默认监听 `http://127.0.0.1:5000`。

也可以分别启动：

```bash
npm run dev-frontend
npm run dev-backend
```

生产构建：

```bash
npm run build --workspace frontend
```

## 本地使用 Vertex AI ADC

Vertex AI 模式依赖本机 Node 代理和 Google Application Default Credentials，只能在本地完整运行时使用，不能直接用于 GitHub Pages 静态站点。

1. 安装并初始化 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)。
2. 完成本地 ADC 登录：

   ```bash
   gcloud auth application-default login
   ```

3. 分别复制前端和后端环境变量模板：

   ```bash
   cp backend/.env.example backend/.env.local
   cp frontend/.env.example frontend/.env.local
   ```

   Windows PowerShell 可使用：

   ```powershell
   Copy-Item backend/.env.example backend/.env.local
   Copy-Item frontend/.env.example frontend/.env.local
   ```

4. 编辑 `backend/.env.local`，设置自己的 `GOOGLE_CLOUD_PROJECT` 和 `GOOGLE_CLOUD_LOCATION`。另外生成一个随机值，并确保后端的 `PROXY_HEADER` 与前端的 `VITE_PROXY_HEADER` 完全相同。
5. 执行 `npm run dev`，在设置中选择 **Google Vertex AI (ADC，仅限本地)**。

`backend/.env.local` 已被 Git 忽略，请勿强制提交。

## 项目结构

```text
studyhelp/
├─ frontend/                  # React + TypeScript + Vite 前端
│  ├─ components/            # 通用界面组件
│  ├─ modules/               # 信号、数学一、英语一模块
│  ├─ services/              # AI 服务适配层
│  └─ utils/                 # 导出等工具
├─ backend/                   # 本地 Vertex AI ADC 代理
├─ .github/workflows/        # GitHub Pages 自动部署
├─ package.json              # npm workspace 与本地启动命令
└─ StudyHelp.bat             # Windows 本地快捷启动脚本
```

## GitHub Pages 部署

仓库的 `main` 分支每次推送后，GitHub Actions 会自动安装依赖、构建 `frontend`，并将 `frontend/dist` 发布到 GitHub Pages。

如首次部署尚未生效，请在仓库 **Settings → Pages → Build and deployment** 中确认 Source 为 **GitHub Actions**，然后重新运行 `Deploy to GitHub Pages` 工作流。

## 常见问题

**打开在线页面后 AI 不工作？**  
先在设置中填写自己的 API Key，并点击连接测试。若提示 CORS，请确认服务商是否允许浏览器直接调用。

**为什么 Pages 上不能使用 Vertex ADC？**  
ADC 凭据和代理运行在本机后端，而 GitHub Pages 只能托管静态文件，无法访问你电脑上的认证环境。

**如何删除浏览器中保存的 Key？**  
清除 `kekeyo.github.io` 的站点数据，或在开发者工具中删除以 `ky_` 开头的本地存储项。

## 免责声明

本项目用于个人学习和原型验证。AI 输出可能包含错误，请对解题过程、公式和作文建议进行独立核验。模型调用产生的费用由所填写 API Key 的持有者承担。

# StudyHelp

StudyHelp 是一个面向**考研复习与题目分析**的 AI 智能学习工作台。

支持上传图片、PDF 等学习资料，并调用不同 AI Provider，对信号与系统、数学一和英语一内容进行识别、分析、解答与整理。

## 功能

* 信号与系统题目分析与分步解答
* 数学一题目识别与推导过程生成
* 英语一作文批改、评价与高分重写
* 图片与 PDF 内容上传
* Markdown 与 LaTeX 公式渲染
* 流式输出与运行状态展示
* Token 用量估算
* TXT / PDF 导出
* BYOK：使用自己的 API Key
* 支持多个 AI Provider

目前支持：

* Google Gemini
* Google Vertex AI
* OpenAI
* DeepSeek
* OpenRouter
* Anthropic Claude
* 自定义 OpenAI Compatible API

---

## 在线使用

直接打开 StudyHelp：

https://kekeyo.github.io/studyhelp/

对于 Gemini、OpenAI、DeepSeek、OpenRouter 等 Provider，只需要在右上角 **AI Provider Settings** 中填写自己的：

* API Key
* Model
* Base URL（如需要）

即可使用。

API Key 由用户自己提供，StudyHelp 不提供公共 API Key。

> 部分 Provider 可能限制浏览器跨域访问。若连接测试提示 CORS，请确认所用服务商或接口是否允许浏览器直连。

---

## Vertex AI

Vertex AI 与普通 API Key 模式不同。

Vertex AI 使用 Google Cloud 的 **Application Default Credentials（ADC）** 进行身份认证，而 GitHub Pages 无法读取用户电脑上的 ADC，也不能运行本项目的 Node.js 代理。

因此：

> 使用 Vertex AI 时，需要在本地运行 StudyHelp。

其他普通 API Provider 不需要执行这一步。

### 1. 配置 Google Cloud ADC

安装 Google Cloud CLI 后执行：

```bash
gcloud auth application-default login
```

然后准备自己的 Google Cloud Project。

---

### 2. 配置环境变量

分别复制：

```text
backend/.env.example
frontend/.env.example
```

为：

```text
backend/.env.local
frontend/.env.local
```

macOS / Linux：

```bash
cp backend/.env.example backend/.env.local
cp frontend/.env.example frontend/.env.local
```

Windows PowerShell：

```powershell
Copy-Item backend/.env.example backend/.env.local
Copy-Item frontend/.env.example frontend/.env.local
```

后端至少填写：

```env
GOOGLE_CLOUD_PROJECT=你的Project ID
GOOGLE_CLOUD_LOCATION=global
PROXY_HEADER=你生成的随机值
```

前端填写同一个随机值：

```env
VITE_PROXY_HEADER=与后端PROXY_HEADER完全相同的随机值
```

`.env.local` 已被 Git 忽略，不要把真实配置提交到仓库。

---

### 3. 安装依赖

在项目根目录执行：

```bash
npm install
```

---

### 4. 本地启动

执行：

```bash
npm run dev
```

然后打开：

```text
http://localhost:5173/
```

在右上角设置中选择 **Google Vertex AI (ADC，仅限本地)**，即可使用本地 Vertex AI 模式。

也可以分别启动前端与后端：

```bash
npm run dev-frontend
npm run dev-backend
```

---

## 如果使用代理

部分网络环境下，Node.js 可能无法直接访问 Google OAuth 或 Vertex AI。

例如使用 Clash，且本地代理端口为：

```text
127.0.0.1:7890
```

可以在启动前设置：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:NO_PROXY="localhost,127.0.0.1"
$env:NODE_USE_ENV_PROXY="1"

npm run dev
```

代理端口请根据自己的代理软件设置修改。

---

## 文件支持

| 内容 / 功能 | 支持情况 | 说明 |
| --- | --- | --- |
| 图片题目 | ✅ | 可用于题目识别、公式分析和作文识别 |
| PDF | ✅ | 在浏览器中解析；复杂扫描件效果取决于清晰度 |
| Markdown | ✅ | 支持标题、列表、表格和代码块 |
| LaTeX 公式 | ✅ | 支持行内公式与块级公式 |
| TXT 导出 | ✅ | 可下载生成内容 |
| PDF 导出 | ✅ | 在浏览器中生成并下载 |

模型是否能够正确理解图片和复杂文档，取决于所选 Provider、模型能力及接口兼容性。

---

## 项目结构

```text
studyhelp/
├── frontend/              # React 前端
│   ├── components/        # 通用界面组件
│   ├── modules/           # 信号与系统、数学一、英语一
│   ├── services/          # AI Provider 适配层
│   └── utils/             # PDF 等导出工具
├── backend/               # 本地 Vertex AI ADC 代理
├── .github/workflows/     # GitHub Pages 自动部署
├── package.json
└── README.md
```

---

## GitHub Pages 部署

`main` 分支每次推送后，GitHub Actions 会自动：

1. 安装依赖
2. 构建 Vite 前端
3. 上传静态产物
4. 发布到 GitHub Pages

本地生产构建命令：

```bash
npm run build --workspace frontend
```

---

## 隐私与安全

StudyHelp 采用 BYOK 模式。

在线版填写的 API Key 保存在当前站点的浏览器 `localStorage` 中，不会写入仓库，但浏览器本地存储并不等同于专业密钥保险库。

请注意：

* 不要把 API Key 提交到 GitHub
* 不要上传 `.env.local`
* 不要上传 Google ADC 凭证
* 不要在公共电脑保存长期有效的 API Key
* 建议为 API Key 设置额度和权限限制，并定期轮换
* 清除 `kekeyo.github.io` 的站点数据可以删除浏览器中保存的配置
* Vertex AI 使用的是用户自己的 Google Cloud 项目与额度

---

## 技术栈

* React
* TypeScript
* Vite
* Node.js
* Express
* Google GenAI SDK
* Tailwind CSS
* KaTeX

---

## 免责声明

StudyHelp 用于个人学习和原型验证。AI 输出可能包含错误，请独立核验解题过程、公式和作文建议。模型调用产生的费用由所填写 API Key 或 Google Cloud 项目的持有者承担。

StudyHelp 的目标是提供一个简单、统一的 AI 考研学习工作台。

**Your Key. Your Model. Your Study.**

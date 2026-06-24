# Interactive Avatar — AI 多模态交互式数字人系统

> **一套完整的 3D 虚拟人交互系统**：支持文字/图片/预设三种方式创建虚拟形象，集成实时语音对话、手势识别触发、3D 渲染与自动绑骨，构建从「生成」到「交互」到「数据沉淀」的全链路闭环。

---

## 📋 项目简介 | Introduction

本项目是一个全栈 AI 交互式数字人系统，包含以下核心能力：

- **多入口建模**：文字描述生成（Meshy Text-to-3D）、图片上传生成（Meshy Image-to-3D）、预设角色一键选用
- **辅助绑骨**：8 点位标注 + Mixamo 风格骨骼绑定 + 蒙皮 + 动作预览
- **场景系统**：图库选择、背景上传、文生图、提示词润色（DashScope/Qwen）
- **实时交互**：MediaPipe 手势识别（挥手触发）、WebSocket 语音对话、Qwen ASR/TTS/LLM、智能打断
- **数据看板**：模型管理、会话历史、对话摘要、录屏上传与回看

---

## 🏗️ 系统架构 | Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Interactive Avatar                      │
├─────────────────────┬───────────────────────────────────┤
│   Frontend (React)  │        Backend (FastAPI)          │
│                     │                                   │
│  Three.js + R3F    │  SQLAlchemy + Alembic + SQLite    │
│  MediaPipe 手势识别 │  WebSocket 实时音频流             │
│  React Router 路由  │  JWT 用户鉴权                     │
│  Ant Design UI      │  Meshy 3D API 集成               │
└─────────────────────┴───────────────────────────────────┘
```

---

## 💡 核心技术 | Key Features

### 1. 三种形象创建方式 | 3 Creation Modes

| 方式 | 输入 | 技术 | 耗时 |
|------|------|------|------|
| 文字生成 | 自然语言描述 | Meshy Text-to-3D | ~5min |
| 图片生成 | 人物照片/手绘 | Meshy Image-to-3D | ~5min |
| 预设选择 | 一键选用 | 本地预置模型 | 即时 |

### 2. 实时语音交互 | Real-time Voice Interaction

- **触发方式**：MediaPipe 手势识别——向摄像头挥手即启动对话
- **语音链路**：Qwen ASR → LLM 对话 → TTS 语音合成，全链路 WebSocket
- **智能打断**：用户可随时插话，系统自动中断当前回复
- **动作同步**：待机/倾听/说话/挥手等多种 3D 动作自动切换

### 3. 辅助绑骨系统 | Auto Rigging

- **8 点位标注**：下巴、腹股沟、左右手腕、左右手肘、左右膝盖
- **智能补全**：基于 Mixamo 标准的自动骨骼绑定与蒙皮
- **实时预览**：绑骨完成后立即预览动作效果

### 4. 数据沉淀 | Data Analytics

- 完整的对话历史记录与搜索
- 自动生成的对话摘要（≤300 字）
- 会话时长、轮次等统计指标
- 录屏上传与回看

---

## 🛠️ 技术栈 | Tech Stack

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端框架 | React 19 + React Router | SPA 路由与组件 |
| 3D 渲染 | Three.js + React Three Fiber | 3D 模型加载与交互 |
| 手势识别 | MediaPipe | 实时人脸/手部检测 |
| UI 组件 | Ant Design / 自研组件 | 界面设计 |
| 后端框架 | FastAPI | RESTful API + WebSocket |
| 数据库 | SQLAlchemy 2 + SQLite + Alembic | 数据持久化与迁移 |
| AI 能力 | Meshy (3D), Qwen/DashScope (语音/文本) | 核心 AI 能力 |
| 鉴权 | JWT (PyJWT) | 用户认证 |

---

## 🚀 快速开始 | Quick Start

### 环境要求 | Prerequisites
- Python 3.11+
- Node.js 18+
- npm 9+

### 1) 启动后端 | Start Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 配置 API 密钥（Meshy, DashScope）
python -m alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8788 --reload
```

后端默认地址：`http://localhost:8788`

### 2) 启动前端 | Start Frontend

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://localhost:5178`

### 3) 访问应用 | Access

打开浏览器访问 `http://localhost:5178`，注册账号后即可开始体验。

---

## 📁 项目结构 | Project Structure

```
Interactive-Avatar/
├── frontend/                     # React 前端
│   ├── src/                      # 页面与组件
│   │   ├── pages/                # Create/Rig/Scene/Interact/Dashboard
│   │   ├── components/           # 3D Viewer, AudioRecorder, 手势识别...
│   │   └── hooks/                # 自定义 Hooks
│   └── public/                   # 静态资源
├── backend/                      # FastAPI 后端
│   ├── app/                      # 核心逻辑
│   │   ├── main.py               # API 入口与 WebSocket
│   │   ├── config.py             # 配置管理
│   │   ├── db.py                 # 数据库连接
│   │   ├── models_db.py          # ORM 模型
│   │   ├── meshy.py              # Meshy API 集成
│   │   └── security.py           # JWT 鉴权
│   └── alembic/                  # 数据库迁移
└── README.md
```

---

## 🏆 比赛成果 | Competition Results

| 赛事 | 等级 | 状态 |
|------|------|------|
| 2026 年中国大学生计算机设计大赛 | 校级/省级 | 参赛中 |
| 4C 人工智能实践赛 | 校级 | 参赛中 |
| 中国国际大学生创新大赛（2026） | 校级 | 参赛中 |

---

## 📄 许可证 | License

MIT License

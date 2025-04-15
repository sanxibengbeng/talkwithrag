# TalkWithRAG - AWS Bedrock RAG 聊天系统

这是一个基于AWS Bedrock RAG能力的聊天系统，使用Node.js实现后端，Bootstrap 5实现前端，并支持实时聊天功能。
仅以来[Bedrock 知识库](https://aws.amazon.com/cn/bedrock/knowledge-bases/)的 混合检索、短期记忆等功能，直接增强RAG效果。

## 功能特点

- 基于AWS Bedrock的RAG（检索增强生成）能力
- 使用Claude 3.5 Haiku模型进行生成
- 使用WebSocket实现实时流式响应
- 支持多轮对话和会话管理
- 聊天记录存储在本地浏览器
- 支持新建对话会话
- 支持引用文档的预签名URL生成
- 响应式设计，适配移动和桌面设备

## 项目结构

```
talkwithrag/
├── src/
│   ├── public/             # 前端代码
│   │   ├── index.html      # 主HTML文件
│   │   ├── styles.css      # 样式文件
│   │   └── app.js          # 前端JavaScript
│   ├── server.js           # Node.js WebSocket服务器
│   └── package.json        # 项目依赖
└── README.md               # 项目说明
```

## 技术实现

### 后端

- Node.js Express服务器
- WebSocket实现实时通信
- AWS Bedrock Agent Runtime API集成
- S3预签名URL生成
- 会话管理和状态维护

### 前端

- Bootstrap 5实现响应式UI
- 原生JavaScript实现WebSocket通信
- 本地存储(localStorage)保存聊天历史
- 实时消息流处理和渲染

## 本地开发

### 前提条件

- Node.js 18+
- AWS CLI已配置，具有Bedrock和S3访问权限
- 已创建Bedrock知识库(Knowledge Base)

### 安装依赖

```bash
cd src
npm install
```

### 本地运行

```bash
cd src
npm run dev
```

访问 http://localhost:3000 查看应用。

## AWS服务配置

### 知识库配置

- 知识库ID: YUX1OWHQBE 这个值是AWS Bedrock knowledgebase的id，需要提前在AWS console 启动 并传入文档；
- 区域: us-east-1
- 使用模型: Claude 3.5 Haiku  POC选择的 3.5Haiku 模型，可以切换到claude 3.5/3.7 sonnet等模型体验效果；

### 权限要求

应用需要以下AWS权限:

- `bedrock:RetrieveAndGenerateStream` - 用于RAG流式响应
- `s3:GetObject` - 用于生成预签名URL
- `bedrock-agent:*` - 用于访问知识库

## 注意事项

- 本地存储聊天记录仅适用于开发环境，生产环境应使用数据库
- 预签名URL有效期为1天
- 确保AWS账户有权限访问Bedrock服务和指定的知识库
- 当前实现使用内存存储会话信息，重启服务器会丢失会话状态

## 技术栈

- 前端：HTML, CSS, JavaScript, Bootstrap 5, WebSocket
- 后端：Node.js, Express, WebSocket
- AWS服务：
  - AWS Bedrock (Claude 3.5 Haiku模型)
  - AWS Bedrock Agent Runtime (RAG能力)
  - Amazon S3 (文档存储和预签名URL)

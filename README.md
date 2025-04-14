# TalkWithRAG - AWS Bedrock RAG 客服聊天系统

这是一个基于AWS Bedrock RAG能力的客服聊天系统，使用Node.js实现后端，Bootstrap 5实现前端，并使用AWS CDK进行部署。

## 功能特点

- 基于AWS Bedrock的RAG（检索增强生成）能力
- 使用Bootstrap 5实现的响应式聊天界面
- 支持多轮对话
- 聊天记录存储在本地
- 支持新建对话会话
- 使用AWS CDK进行部署

## 项目结构

```
talkwithrag/
├── src/
│   ├── frontend/           # 前端代码
│   │   ├── index.html      # 主HTML文件
│   │   ├── styles.css      # 样式文件
│   │   └── app.js          # 前端JavaScript
│   ├── backend/            # 后端代码
│   │   ├── server.js       # Node.js服务器
│   │   └── package.json    # 后端依赖
│   └── cdk/                # CDK部署代码
│       ├── bin/            # CDK入口点
│       ├── lib/            # CDK堆栈定义
│       ├── package.json    # CDK依赖
│       └── tsconfig.json   # TypeScript配置
└── Dockerfile              # Docker构建文件
```

## 本地开发

### 前提条件

- Node.js 18+
- AWS CLI已配置
- AWS CDK已安装

### 安装依赖

```bash
# 安装后端依赖
cd src/backend
npm install

# 安装CDK依赖
cd ../cdk
npm install
```

### 本地运行

```bash
cd src/backend
npm run dev
```

访问 http://localhost:3000 查看应用。

## 部署到AWS

### 构建和部署

```bash
# 初始化CDK（如果是首次在AWS账户中使用CDK）
cd src/cdk
cdk bootstrap

# 部署应用
cdk deploy
```

部署完成后，CDK将输出应用的URL。

## 技术栈

- 前端：HTML, CSS, JavaScript, Bootstrap 5
- 后端：Node.js, Express
- AWS服务：
  - AWS Bedrock (Claude模型和RAG能力)
  - Amazon ECS (Fargate)
  - Application Load Balancer
  - Amazon VPC
  - IAM

## 注意事项

- 确保AWS账户有权限访问Bedrock服务
- 知识库ID配置为us-east-1区域中的YUX1OWHQBE
- 本地存储聊天记录仅适用于开发环境，生产环境应使用数据库

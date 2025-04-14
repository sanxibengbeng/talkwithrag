1. 结合AWS的bedrock RAG能力，调用美东1区的 RAG 实现一个客服聊天界面，聊天界面基于bootstrap5 实现，支持自适应以及多轮对话；
2. 聊天记录存放在本地, 问答过程这样实现，用模型整理历史聊天记录总结得到最新的问题；然后用整理出来的问题调用RAG接口，知识库使用us-east-1 中的knowledgebase id是YUX1OWHQBE
3. 支持新建对话session；
6. nodejs 实现 服务端代码
7.代码全部放在src目录下
8.规划cdk目录，参考/Users/yulongzh/projects/code-gen/cdk 将这个代码部署到AWS账号里面
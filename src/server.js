const express = require('express');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// AWS Configuration
const MODEL_REGION = 'us-west-2';
const RAG_REGION = 'us-east-1';
const KNOWLEDGE_BASE_ID = 'YUX1OWHQBE';
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20240620-v1:0';

const bedrockRuntime = new BedrockRuntimeClient({ region: MODEL_REGION });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region: RAG_REGION });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store chat history in memory (in production, use a database)
const chatSessions = new Map();

// Helper function to summarize chat history using Claude
async function summarizeHistory(history, message) {
    if (history.length === 0) return message;
    
    // Include the current message in the conversation to be summarized
    const fullConversation = [
        ...history,
        { role: 'user', content: message }
    ];
    
    const messages = [
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: `请分析以下对话内容，并提供两部分信息：
1. 客户背景信息：总结客户之前提到的关键信息、问题和需求
2. 当前问题：明确提取客户最新的问题或请求

请使用简洁的语言，确保包含所有重要细节。仅返回这两部分内容，不要添加其他解释。

对话内容：
${fullConversation.map(msg => `${msg.role === 'user' ? '客户' : '客服'}: ${msg.content}`).join('\n')}`
                }
            ]
        }
    ];
    console.log("summarize history", messages)

    const params = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 500,
            messages: messages,
            temperature: 0.1,
            top_p: 0.9
        })
    };

    try {
        const command = new InvokeModelCommand(params);
        const response = await bedrockRuntime.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log("summarize history response:", responseBody.content)
        return responseBody.content[0].text;
    } catch (error) {
        console.error('Error summarizing history:', error);
        return message;
    }
}

// Helper function to query RAG knowledge base using RetrieveAndGenerate
async function queryRAG(question, sessionId = null) {

    const input = {
        input: {
            text: question
        },
        retrieveAndGenerateConfiguration: {
            type: "KNOWLEDGE_BASE",
            knowledgeBaseConfiguration: {
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                modelArn: `arn:aws:bedrock:${RAG_REGION}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`
            }
        }
    };
    console.log(input)

    try {
        const command = new RetrieveAndGenerateCommand(input);
        const response = await bedrockAgentRuntime.send(command);
        
        console.log('RAG response:', response);
        
        // Extract citation information
        let citation = null;
        if (response.citations && response.citations.length > 0) {
            const location = response.citations[0]?.retrievedReferences[0]?.location;
            if (location) {
                if (location.type === "S3") {
                    citation = location.s3Location.uri;
                } else if (location.type === "WEB") {
                    citation = location.webLocation.url;
                }
            }
        }
        
        return {
            text: response.output.text,
            citation: citation,
            sessionId: response.sessionId
        };
    } catch (error) {
        console.error('Error querying RAG:', error);
        throw error;
    }
}

// Helper function to generate response using Claude
async function generateResponse(question, context = '') {
    const messages = [
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: context ? 
                        `Context information:\n${context}\n\nBased on the context above, please answer the following question:\n${question}\n\nPlease provide a clear and concise response using only the information from the context. If the context doesn't contain relevant information, please say so.` :
                        `Please answer the following question:\n${question}\n\nProvide a clear and concise response.`
                }
            ]
        }
    ];

    const params = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            messages: messages,
            temperature: 0.7,
            top_p: 0.9
        })
    };

    try {
        const command = new InvokeModelCommand(params);
        const response = await bedrockRuntime.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.content[0].text;
    } catch (error) {
        console.error('Error generating response:', error);
        throw error;
    }
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message, sessionId, history } = req.body;

        // Store or update chat history
        if (!chatSessions.has(sessionId)) {
            chatSessions.set(sessionId, []);
        }
        
        const currentHistory = [...history];
        
        // Summarize the conversation to get the latest intent and background
        const summarizedContent = await summarizeHistory(currentHistory, message);
        
        // Query the RAG knowledge base with the summarized content
        const ragResponse = await queryRAG(summarizedContent);
        
        // Update chat history
        currentHistory.push({ role: 'user', content: message });
        currentHistory.push({ role: 'assistant', content: ragResponse.text });
        chatSessions.set(sessionId, currentHistory);
        
        res.json({ 
            response: ragResponse.text,
            citation: ragResponse.citation,
            sessionId: ragResponse.sessionId
        });
    } catch (error) {
        console.error('Error processing chat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

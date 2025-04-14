const express = require('express');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { BedrockAgentRuntimeClient, RetrieveAndGenerateStreamCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// AWS Configuration
const MODEL_REGION = 'us-west-2';
const RAG_REGION = 'us-east-1';
const KNOWLEDGE_BASE_ID = 'YUX1OWHQBE';
//const MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0';
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20240620-v1:0';

const bedrockRuntime = new BedrockRuntimeClient({ region: MODEL_REGION });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region: RAG_REGION });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory chat session storage (replace with a database in production)
const chatSessions = new Map();
const MAX_HISTORY_LENGTH = 20; // Limit stored chat history
const MAX_SUMMARY_HISTORY = 10; // Limit messages sent for summarization

// WebSocket connections map
const wsConnections = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected');
    
    // Handle messages from client
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);
            
            // Handle different message types
            if (data.type === 'register') {
                // Register this connection with a session ID
                wsConnections.set(data.sessionId, ws);
                console.log(`WebSocket registered for session: ${data.sessionId}`);
                
                // Send acknowledgment
                ws.send(JSON.stringify({
                    type: 'registered',
                    sessionId: data.sessionId
                }));
            } 
            else if (data.type === 'chat') {
                // Process chat message
                const { message, sessionId } = data;
                
                // Validate request
                if (!message || !sessionId) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Missing message or sessionId'
                    }));
                    return;
                }
                
                // Use server-stored history
                let currentHistory = chatSessions.get(sessionId) || [];
                
                // Limit history for summarization
                const historyForSummary = currentHistory.slice(-MAX_SUMMARY_HISTORY);
                const summarizedContent = await summarizeHistory(historyForSummary, message);
                
                // Send start event
                ws.send(JSON.stringify({ type: 'start' }));
                
                // Stream RAG response
                try {
                    const ragResponse = await streamRAG(summarizedContent, ws);
                    
                    // Update and limit chat history
                    currentHistory.push({ role: 'user', content: message });
                    currentHistory.push({ role: 'assistant', content: ragResponse.text });
                    if (currentHistory.length > MAX_HISTORY_LENGTH) {
                        currentHistory = currentHistory.slice(-MAX_HISTORY_LENGTH);
                    }
                    chatSessions.set(sessionId, currentHistory);
                    
                    // Send done event
                    ws.send(JSON.stringify({ type: 'done' }));
                } catch (error) {
                    console.error('Error in RAG processing:', error);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `RAG error: ${error.message}`
                    }));
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: `Error: ${error.message}`
            }));
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        // Remove connection from the map (find by value)
        for (const [sessionId, connection] of wsConnections.entries()) {
            if (connection === ws) {
                wsConnections.delete(sessionId);
                console.log(`Removed connection for session: ${sessionId}`);
                break;
            }
        }
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Summarize chat history using Claude
async function summarizeHistory(history, message) {
    if (history.length === 0) return message;

    const fullConversation = [...history, { role: 'user', content: message }];
    const messages = [
        {
            role: 'user',
            content: [
                {
                    type: 'text',
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

    const params = {
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 500,
            messages,
            temperature: 0.1,
            top_p: 0.9
        })
    };

    try {
        const command = new InvokeModelCommand(params);
        const response = await bedrockRuntime.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.content[0].text;
    } catch (error) {
        console.error('Error summarizing history:', error);
        return message; // Fallback to original message on error
    }
}

// Stream response from RAG knowledge base
async function streamRAG(question, ws) {
    const input = {
        input: { text: question },
        retrieveAndGenerateConfiguration: {
            type: 'KNOWLEDGE_BASE',
            knowledgeBaseConfiguration: {
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                modelArn: `arn:aws:bedrock:${RAG_REGION}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`
            }
        }
    };

    console.log("Stream RAG input:", JSON.stringify(input, null, 2));

    try {
        const command = new RetrieveAndGenerateStreamCommand(input);
        const response = await bedrockAgentRuntime.send(command);

        let fullText = '';
        let citation = null;
        let responseSessionId = null;
        let hasChunks = false;

        for await (const event of response.stream) {
            // Log event type for debugging
            const eventTypes = Object.keys(event);
            console.log("Stream event type:", eventTypes);
            
            // Handle text chunks
            if (event?.output) {
                hasChunks = true;
                const textChunk = event.output?.text
                console.log("Received text chunk:", textChunk);
                
                // Append to full text
                fullText += textChunk;
                
                // Send chunk to client via WebSocket
                ws.send(JSON.stringify({ 
                    type: 'chunk', 
                    content: textChunk 
                }));
            } 
            // Handle retrieval results (citations)
            else if (event.retrievalResults) {
                console.log("Received retrieval results:", JSON.stringify(event.retrievalResults, null, 2));
                
                try {
                    const retrievalResults = event.retrievalResults;
                    
                    if (retrievalResults.retrievedReferences && retrievalResults.retrievedReferences.length > 0) {
                        // Process each reference
                        for (const reference of retrievalResults.retrievedReferences) {
                            if (reference.location) {
                                const location = reference.location;
                                let citationUrl = null;
                                
                                if (location.type === "S3") {
                                    citationUrl = location.s3Location?.uri;
                                } else if (location.type === "WEB") {
                                    citationUrl = location.webLocation?.url;
                                }
                                
                                // Send citation to client if available
                                if (citationUrl) {
                                    citation = citationUrl; // Store the last citation
                                    console.log("Sending citation:", citationUrl);
                                    ws.send(JSON.stringify({ 
                                        type: 'citation', 
                                        citation: citationUrl 
                                    }));
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error processing retrieval results:", error);
                }
            }
            // Handle metadata (session ID)
            else if (event.metadata) {
                console.log("Received metadata:", JSON.stringify(event.metadata, null, 2));
                
                try {
                    if (event.metadata.sessionId) {
                        responseSessionId = event.metadata.sessionId;
                        ws.send(JSON.stringify({ 
                            type: 'metadata', 
                            sessionId: responseSessionId 
                        }));
                    }
                } catch (error) {
                    console.error("Error processing metadata:", error);
                }
            }
            // Log any unexpected event types
            else {
                console.log("Unhandled event type:", Object.keys(event));
            }
        }

        // If no chunks were received, send an error
        if (!hasChunks) {
            console.warn("No text chunks received from the stream");
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'No response generated. Please try again.' 
            }));
        }
        
        return { 
            text: fullText, 
            citation, 
            sessionId: responseSessionId 
        };
    } catch (error) {
        console.error('Error in streaming RAG:', error);
        ws.send(JSON.stringify({ 
            type: 'error', 
            message: `RAG error: ${error.message}` 
        }));
        throw error;
    }
}

// Start server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

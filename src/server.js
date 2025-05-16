const express = require('express');
// const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { BedrockAgentRuntimeClient, RetrieveAndGenerateStreamCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
// const fs = require('fs').promises;
// const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// AWS Configuration
// const MODEL_REGION = 'us-west-2';
// const RAG_REGION = 'us-east-1';
// const KNOWLEDGE_BASE_ID = 'YUX1OWHQBE';
// const modelArn =  `arn:aws:bedrock:us-east-1:873543029686:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0`
const RAG_REGION = 'us-west-2';
const KNOWLEDGE_BASE_ID = 'PGOTJNKSBU';
//const modelArn =  `arn:aws:bedrock:${RAG_REGION}:873543029686:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0`
const modelArn =  `arn:aws:bedrock:${RAG_REGION}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`
// const MODEL_ID = 'anthropic.claude-3-5-haiku-20241022-v1:0';
const PRESIGNED_URL_EXPIRATION = 86400; // 1 day in seconds

// const bedrockRuntime = new BedrockRuntimeClient({ region: MODEL_REGION });
const bedrockAgentRuntime = new BedrockAgentRuntimeClient({ region: RAG_REGION });
const s3Client = new S3Client({ region: RAG_REGION });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory chat session storage (replace with a database in production)
const chatSessions = new Map();
const knowledgebaseSessions = new Map();
const MAX_HISTORY_LENGTH = 20; // Limit stored chat history
// const MAX_SUMMARY_HISTORY = 10; // Limit messages sent for summarization

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
                
                // Send start event
                ws.send(JSON.stringify({ type: 'start' }));
                
                // Stream RAG response
                try {
                    const ragResponse = await streamRAG(message, sessionId, ws);
                    
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
// async function summarizeHistory(history, message) {
//     if (history.length === 0) return message;

//     const fullConversation = [...history, { role: 'user', content: message }];
//     const messages = [
//         {
//             role: 'user',
//             content: [
//                 {
//                     type: 'text',
//                     text: `Please analyze the following conversation and extract two key components:

// 1. Customer Profile:
//    - Extract personal background, needs, and pain points
//    - Summarize key information and historical issues previously mentioned
//    - Identify customer priorities and preferences

// 2. Current Inquiry Focus:
//    - Clearly define the core problem or request most recently expressed
//    - Extract any time-sensitive elements or urgent needs
//    - Identify the type of solution the customer expects

// Present your analysis in concise, structured bullet points, ensuring all information valuable for follow-up service is included. Provide only these two components without additional explanation.

// Conversation:
// ${fullConversation.map(msg => `${msg.role === 'user' ? '客户' : '客服'}: ${msg.content}`).join('\n')}`
//                 }
//             ]
//         }
//     ];

//     const params = {
//         modelId: MODEL_ID,
//         contentType: 'application/json',
//         accept: 'application/json',
//         body: JSON.stringify({
//             anthropic_version: 'bedrock-2023-05-31',
//             max_tokens: 500,
//             messages,
//             temperature: 0.1,
//             top_p: 0.9
//         })
//     };

//     try {
//         const command = new InvokeModelCommand(params);
//         const response = await bedrockRuntime.send(command);
//         const responseBody = JSON.parse(new TextDecoder().decode(response.body));
//         return responseBody.content[0].text;
//     } catch (error) {
//         console.error('Error summarizing history:', error);
//         return message; // Fallback to original message on error
//     }
// }

// Generate a presigned URL for an S3 object
async function generatePresignedUrl(s3Uri) {
    try {
        // Parse the S3 URI to extract bucket and key
        // Format: s3://bucket-name/path/to/object
        if (!s3Uri || !s3Uri.startsWith('s3://')) {
            console.error('Invalid S3 URI format:', s3Uri);
            return s3Uri; // Return original URI if invalid
        }

        const uriWithoutProtocol = s3Uri.substring(5); // Remove 's3://'
        const firstSlashIndex = uriWithoutProtocol.indexOf('/');
        
        if (firstSlashIndex === -1) {
            console.error('Invalid S3 URI format (no key):', s3Uri);
            return s3Uri;
        }
        
        const bucketName = uriWithoutProtocol.substring(0, firstSlashIndex);
        const objectKey = uriWithoutProtocol.substring(firstSlashIndex + 1);
        
        // Create the command to get the object
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey
        });
        
        // Generate the presigned URL with 1-day expiration
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRATION });
        console.log(`Generated presigned URL for ${s3Uri}`);
        
        return presignedUrl;
    } catch (error) {
        console.error('Error generating presigned URL:', error);
        return s3Uri; // Return original URI on error
    }
}
async function streamRAG(question,seesionId, ws) {
    ragSessionID = knowledgebaseSessions.get(seesionId) || ""
    const input = {
        seesionId: ragSessionID,
        input: { text: question },
        retrieveAndGenerateConfiguration: {
            type: 'KNOWLEDGE_BASE',
            knowledgeBaseConfiguration: {
                knowledgeBaseId: KNOWLEDGE_BASE_ID,
                modelArn: modelArn,
                orchestrationConfiguration: {
                    inferenceConfig: {
                        textInferenceConfig: {
                            maxTokens: 4096,
                            stopSequences: [
                                "\nObservation"
                            ],
                            temperature: 0,
                            topP: 1
                        }
                    }
                },
                retrievalConfiguration: {
                    vectorSearchConfiguration: {
                        numberOfResults: 10,
                        overrideSearchType: "HYBRID"
                    }
                },
                generationConfiguration: {
                    inferenceConfig: {
                        textInferenceConfig: {
                            maxTokens: 4096,
                            stopSequences: [
                                "\nObservation"
                            ],
                            temperature: 0,
                            topP: 1
                        }
                    }
                }
            }
        }
    };

    console.log("Stream RAG input:", JSON.stringify(input, null, 2));

    try {
        const command = new RetrieveAndGenerateStreamCommand(input);
        const response = await bedrockAgentRuntime.send(command);

        let fullText = '';
        let citations = [];
        let hasChunks = false;

        // Extract session ID from headers
        let responseSessionId = response.sessionId
        // Log the header for debugging
        console.log("Session ID from header:", responseSessionId);

        // If session ID was found in header, send it to client
        if (responseSessionId) {
            knowledgebaseSessions.set(seesionId, responseSessionId)
            ws.send(JSON.stringify({
                type: 'responseSessionId',
                sessionId: responseSessionId
            }));
        }

        for await (const event of response.stream) {
            // Handle text chunks
            if (event?.output) {
                hasChunks = true;
                const textChunk = event.output?.text
                
                // Append to full text
                fullText += textChunk;
                
                // Send chunk to client via WebSocket
                ws.send(JSON.stringify({ 
                    type: 'chunk', 
                    content: textChunk 
                }));
            } 
            // 处理引用信息
            else if (event?.citation) {
                // 获取所有引用
                const references = event.citation?.retrievedReferences;
                let s3Uri = ""

                // 遍历引用
                references.forEach(reference => {
                    // 获取 s3Location.uri (如果存在)
                    if (reference.location && reference.location.s3Location) {
                        s3Uri = reference.location.s3Location.uri;
                    }
                });
                
                // Generate presigned URL for the S3 URI
                const presignedUrl = await generatePresignedUrl(s3Uri);
                
                citations.push(presignedUrl);
                ws.send(JSON.stringify({ 
                    type: 'citation', 
                    citation: presignedUrl
                }));
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
            citations: citations, 
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

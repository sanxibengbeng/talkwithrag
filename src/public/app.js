document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const newChatButton = document.getElementById('newChat');
    const chatHistory = document.getElementById('chatHistory');
    
    // Current chat session ID
    let currentSessionId = generateSessionId();
    
    // WebSocket connection
    let socket = null;
    let isConnected = false;
    
    // Connect to WebSocket server
    function connectWebSocket() {
        // Create WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        socket = new WebSocket(wsUrl);
        
        // Connection opened
        socket.addEventListener('open', (event) => {
            console.log('WebSocket connected');
            isConnected = true;
            
            // Register this connection with the current session ID
            socket.send(JSON.stringify({
                type: 'register',
                sessionId: currentSessionId
            }));
        });
        
        // Listen for messages
        socket.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received WebSocket message:', data);
                
                // Handle different message types
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        });
        
        // Connection closed
        socket.addEventListener('close', (event) => {
            console.log('WebSocket disconnected');
            isConnected = false;
            
            // Attempt to reconnect after a delay
            setTimeout(() => {
                if (!isConnected) {
                    console.log('Attempting to reconnect WebSocket...');
                    connectWebSocket();
                }
            }, 3000);
        });
        
        // Connection error
        socket.addEventListener('error', (event) => {
            console.error('WebSocket error:', event);
            isConnected = false;
        });
    }
    
    // Handle WebSocket messages
    let currentBotMessageElement = null;
    let currentResponseText = '';
    let currentResponseCitations = [];
    
    function handleWebSocketMessage(data) {
        // Ensure we have a bot message element to update
        if (!currentBotMessageElement) {
            return;
        }
        
        switch (data.type) {
            case 'registered':
                console.log('WebSocket registered with session ID:', data.sessionId);
                break;
                
            case 'start':
                // Clear the "Thinking..." message when streaming starts
                currentBotMessageElement.innerHTML = '';
                currentResponseText = '';
                currentResponseCitations = [];
                break;
                
            case 'metadata':
                // Clear the "Thinking..." message if not already cleared
                if (currentBotMessageElement.innerHTML.includes('Thinking')) {
                    currentBotMessageElement.innerHTML = '';
                }
                break;
                
            case 'chunk':
                // Append chunk to response text
                currentResponseText += data.content;
                // Update the message with current text
                currentBotMessageElement.innerHTML = currentResponseText.replace(/\n/g, '<br>');
                // Scroll to bottom
                chatMessages.scrollTop = chatMessages.scrollHeight;
                break;
                
            case 'citation':
                // 保留单个引用的处理，用于向后兼容
                if (!currentResponseCitations.some(c => c.url === data.citation)) {
                    currentResponseCitations.push({
                        url: data.citation,
                        title: null
                    });
                }
                console.log("Received single citation:", data.citation);
                break;
                
            case 'citations':
                // 处理新的引用数组
                currentResponseCitations = data.citations;
                console.log("Received citations:", data.citations);
                break;
                
            case 'done':
                // If we got 'done' but no text, show an error
                if (!currentResponseText) {
                    currentBotMessageElement.innerHTML = 'No response received. Please try again.';
                    return;
                }
                
                // Add citations if available
                if (currentResponseCitations && currentResponseCitations.length > 0) {
                    const citationsContainer = document.createElement('div');
                    citationsContainer.className = 'citations-container';
                    
                    // 添加引用标题
                    if (currentResponseCitations.length > 1) {
                        const citationsTitle = document.createElement('div');
                        citationsTitle.className = 'citations-title';
                        citationsTitle.textContent = '参考资料:';
                        citationsContainer.appendChild(citationsTitle);
                    }
                    
                    // 添加每个引用
                    currentResponseCitations.forEach((citation, index) => {
                        const citationElement = document.createElement('div');
                        citationElement.className = 'citation';
                        
                        // 创建链接
                        const link = document.createElement('a');
                        link.href = citation.url;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        
                        // 使用标题或URL作为链接文本
                        link.textContent = citation.title || `参考资料 ${index + 1}`;
                        
                        citationElement.appendChild(link);
                        
                        // 如果有摘要，添加摘要
                        if (citation.snippet) {
                            const snippet = document.createElement('div');
                            snippet.className = 'citation-snippet';
                            snippet.textContent = citation.snippet;
                            citationElement.appendChild(snippet);
                        }
                        
                        citationsContainer.appendChild(citationElement);
                    });
                    
                    currentBotMessageElement.appendChild(citationsContainer);
                }
                
                // Get the last user message
                const lastUserMessage = messageInput.dataset.lastMessage || '';
                
                // Update chat session
                updateChatSession(currentSessionId, lastUserMessage, currentResponseText);
                
                // Update chat history title with summary
                updateChatHistoryTitle(currentSessionId, lastUserMessage);
                
                // Reset current message tracking
                currentBotMessageElement = null;
                break;
                
            case 'error':
                currentBotMessageElement.innerHTML = `Error: ${data.message || 'Unknown error'}`;
                // Reset current message tracking
                currentBotMessageElement = null;
                break;
                
            default:
                console.warn('Unknown WebSocket message type:', data.type);
        }
    }
    
    // Initialize WebSocket connection
    connectWebSocket();
    
    // Load chat sessions from localStorage
    loadChatSessions();
    
    // Create a new chat session
    newChatButton.addEventListener('click', () => {
        currentSessionId = generateSessionId();
        chatMessages.innerHTML = '';
        
        // Add new chat to history
        addChatToHistory(currentSessionId, 'New Chat');
        
        // Save empty chat session
        saveChatSession(currentSessionId, []);
        
        // Set this as active chat
        setActiveChat(currentSessionId);
        
        // Register new session with WebSocket if connected
        if (isConnected) {
            socket.send(JSON.stringify({
                type: 'register',
                sessionId: currentSessionId
            }));
        }
    });
    
    // Handle form submission
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        if (!message) return;
        
        // Store the message for later use
        messageInput.dataset.lastMessage = message;
        
        // Add user message to UI
        addMessage(message, 'user');
        
        // Clear input
        messageInput.value = '';
        
        try {
            // Check if WebSocket is connected
            if (!isConnected) {
                addMessage('Connection to server lost. Trying to reconnect...', 'bot');
                connectWebSocket();
                return;
            }
            
            // Create message container for bot response
            const botMessageElement = document.createElement('div');
            botMessageElement.className = 'message bot-message';
            botMessageElement.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> Thinking...';
            chatMessages.appendChild(botMessageElement);
            
            // Set as current bot message element for WebSocket updates
            currentBotMessageElement = botMessageElement;
            
            // Get chat history for this session
            const chatSession = getChatSession(currentSessionId);
            
            // Send message via WebSocket
            socket.send(JSON.stringify({
                type: 'chat',
                sessionId: currentSessionId,
                message: message,
                history: chatSession
            }));
            
        } catch (error) {
            console.error('Error:', error);
            addMessage('Sorry, there was an error processing your request.', 'bot');
        }
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    // Helper functions
    function generateSessionId() {
        return Date.now().toString();
    }
    
    function addMessage(content, sender, citation = null) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;
        
        // Replace \n with <br> for proper line breaks
        const formattedContent = content.replace(/\n/g, '<br>');
        messageElement.innerHTML = formattedContent;
        
        // Add citation if available
        if (citation && sender === 'bot') {
            const citationElement = document.createElement('div');
            citationElement.className = 'citation';
            citationElement.innerHTML = `<a href="${citation}" target="_blank" rel="noopener noreferrer">Source</a>`;
            messageElement.appendChild(citationElement);
        }
        
        chatMessages.appendChild(messageElement);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    function saveChatSession(sessionId, messages) {
        localStorage.setItem(`chat_${sessionId}`, JSON.stringify(messages));
        
        // Save session list
        const sessions = getSessions();
        if (!sessions.includes(sessionId)) {
            sessions.push(sessionId);
            localStorage.setItem('chat_sessions', JSON.stringify(sessions));
        }
    }
    
    function getChatSession(sessionId) {
        const session = localStorage.getItem(`chat_${sessionId}`);
        return session ? JSON.parse(session) : [];
    }
    
    function updateChatSession(sessionId, userMessage, botResponse) {
        const session = getChatSession(sessionId);
        session.push({
            role: 'user',
            content: userMessage
        });
        session.push({
            role: 'assistant',
            content: botResponse
        });
        saveChatSession(sessionId, session);
    }
    
    function getSessions() {
        const sessions = localStorage.getItem('chat_sessions');
        return sessions ? JSON.parse(sessions) : [];
    }
    
    function loadChatSessions() {
        const sessions = getSessions();
        
        if (sessions.length === 0) {
            // Create first session if none exist
            saveChatSession(currentSessionId, []);
            addChatToHistory(currentSessionId, 'New Chat');
        } else {
            // Load existing sessions
            sessions.forEach(sessionId => {
                const chatSession = getChatSession(sessionId);
                let title = 'New Chat';
                
                // Use first user message as title if available
                for (const message of chatSession) {
                    if (message.role === 'user') {
                        title = message.content.substring(0, 20) + (message.content.length > 20 ? '...' : '');
                        break;
                    }
                }
                
                addChatToHistory(sessionId, title);
            });
            
            // Set the most recent chat as active
            currentSessionId = sessions[sessions.length - 1];
            setActiveChat(currentSessionId);
            loadChatMessages(currentSessionId);
        }
    }
    
    function addChatToHistory(sessionId, title) {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.sessionId = sessionId;
        chatItem.textContent = title;
        
        chatItem.addEventListener('click', () => {
            currentSessionId = sessionId;
            setActiveChat(sessionId);
            loadChatMessages(sessionId);
            
            // Register with WebSocket if connected
            if (isConnected) {
                socket.send(JSON.stringify({
                    type: 'register',
                    sessionId: currentSessionId
                }));
            }
        });
        
        chatHistory.appendChild(chatItem);
    }
    
    function setActiveChat(sessionId) {
        // Remove active class from all chats
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to current chat
        const currentChat = document.querySelector(`.chat-item[data-session-id="${sessionId}"]`);
        if (currentChat) {
            currentChat.classList.add('active');
        }
    }
    
    function loadChatMessages(sessionId) {
        // Clear current messages
        chatMessages.innerHTML = '';
        
        // Load messages for this session
        const chatSession = getChatSession(sessionId);
        
        chatSession.forEach(message => {
            // We don't have citation for historical messages, so pass null
            addMessage(message.content, message.role === 'user' ? 'user' : 'bot', null);
        });
    }
    
    function updateChatHistoryTitle(sessionId, message) {
        const title = message.substring(0, 20) + (message.length > 20 ? '...' : '');
        const chatItem = document.querySelector(`.chat-item[data-session-id="${sessionId}"]`);
        if (chatItem) {
            chatItem.textContent = title;
        }
    }
});

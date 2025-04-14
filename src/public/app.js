document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const newChatButton = document.getElementById('newChat');
    const chatHistory = document.getElementById('chatHistory');
    
    // Current chat session ID
    let currentSessionId = generateSessionId();
    
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
    });
    
    // Handle form submission
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        if (!message) return;
        
        // Add user message to UI
        addMessage(message, 'user');
        
        // Clear input
        messageInput.value = '';
        
        try {
            // Show loading indicator
            const loadingElement = document.createElement('div');
            loadingElement.className = 'message bot-message';
            loadingElement.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> Thinking...';
            chatMessages.appendChild(loadingElement);
            
            // Get chat history for this session
            const chatSession = getChatSession(currentSessionId);
            
            // Send message to backend
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    sessionId: currentSessionId,
                    history: chatSession
                })
            });
            
            // Remove loading indicator
            chatMessages.removeChild(loadingElement);
            
            if (!response.ok) {
                throw new Error('Failed to get response');
            }
            
            const data = await response.json();
            
            // Add bot response to UI with citation if available
            addMessage(data.response, 'bot', data.citation);
            
            // Update chat session
            updateChatSession(currentSessionId, message, data.response);
            
            // Update chat history title with summary
            updateChatHistoryTitle(currentSessionId, message);
            
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

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
            // Create message container for bot response
            const botMessageElement = document.createElement('div');
            botMessageElement.className = 'message bot-message';
            botMessageElement.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div> Thinking...';
            chatMessages.appendChild(botMessageElement);
            
            // Get chat history for this session
            const chatSession = getChatSession(currentSessionId);
            
            // Prepare for streaming response
            let responseText = '';
            let responseCitation = null;
            let responseSessionId = null;
            
            // Create a new EventSource for this request
            const eventSource = new EventSource(`/api/chat?sessionId=${currentSessionId}`);
            
            // Send message to backend using fetch to initiate the stream
            fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    sessionId: currentSessionId,
                    history: chatSession
                })
            }).catch(error => {
                console.error('Error sending message:', error);
                botMessageElement.innerHTML = 'Failed to send message. Please try again.';
                eventSource.close();
            });
            
            // Set a timeout to handle cases where the server doesn't respond
            const timeoutId = setTimeout(() => {
                console.error('Response timeout');
                botMessageElement.innerHTML = 'Server response timeout. Please try again.';
                eventSource.close();
            }, 30000); // 30 seconds timeout
            
            // Handle streaming events
            eventSource.onmessage = (event) => {
                try {
                    console.log('Raw event data:', event.data);
                    const data = JSON.parse(event.data);
                    console.log('Parsed event:', data);
                    
                    // Clear timeout on any message
                    clearTimeout(timeoutId);
                    
                    // Handle different event types
                    switch (data.type) {
                        case 'start':
                            // Clear the "Thinking..." message when streaming starts
                            botMessageElement.innerHTML = '';
                            break;
                            
                        case 'metadata':
                            responseSessionId = data.sessionId;
                            // Clear the "Thinking..." message if not already cleared
                            if (botMessageElement.innerHTML.includes('Thinking')) {
                                botMessageElement.innerHTML = '';
                            }
                            break;
                            
                        case 'chunk':
                            // Append chunk to response text
                            responseText += data.content;
                            // Update the message with current text
                            botMessageElement.innerHTML = responseText.replace(/\n/g, '<br>');
                            break;
                            
                        case 'citation':
                            responseCitation = data.citation;
                            console.log("Received citation:", data.citation);
                            break;
                            
                        case 'done':
                            // If we got 'done' but no text, show an error
                            if (!responseText) {
                                botMessageElement.innerHTML = 'No response received. Please try again.';
                                eventSource.close();
                                return;
                            }
                            
                            // Add citation if available
                            if (responseCitation) {
                                const citationElement = document.createElement('div');
                                citationElement.className = 'citation';
                                citationElement.innerHTML = `<a href="${responseCitation}" target="_blank" rel="noopener noreferrer">Source</a>`;
                                botMessageElement.appendChild(citationElement);
                            }
                            
                            // Update chat session
                            updateChatSession(currentSessionId, message, responseText);
                            
                            // Update chat history title with summary
                            updateChatHistoryTitle(currentSessionId, message);
                            
                            // Close the event source
                            eventSource.close();
                            break;
                            
                        case 'error':
                            botMessageElement.innerHTML = `Error: ${data.message || 'Unknown error'}`;
                            eventSource.close();
                            break;
                            
                        default:
                            console.warn('Unknown event type:', data.type);
                    }
                    
                    // Scroll to bottom
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } catch (error) {
                    console.error('Error parsing event data:', error, event.data);
                    botMessageElement.innerHTML = 'Error processing response. Please try again.';
                    eventSource.close();
                    clearTimeout(timeoutId);
                }
            };
            
            // Handle connection errors
            eventSource.onerror = (error) => {
                console.error('EventSource error:', error);
                botMessageElement.innerHTML = 'Connection error. Please try again.';
                eventSource.close();
                clearTimeout(timeoutId);
            };
            
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

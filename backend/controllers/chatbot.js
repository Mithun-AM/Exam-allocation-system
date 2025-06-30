const { ChatGroq } = require('@langchain/groq');
const { HumanMessage, AIMessage, SystemMessage } = require('@langchain/core/messages');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');
const { formatDocumentsAsString } = require('langchain/util/document');

const knowledgeBase = require('../services/knowledgeBase');
const conversationService = require('../services/conversationService');

// Initialize the Groq chat model
const initChatModel = () => {
  // Validate API key
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama3-70b-8192",
    temperature: 0.7,
  });
  return model;
};

// Create system message for the chatbot
const createSystemMessage = () => {
  return new SystemMessage(
    `You are a helpful assistant for an Exam Allocation System.
    
    Your role is to help users with information about exams, room allocations, faculty assignments, and other related queries.
    
    For faculty users, you can provide information about their current, past, and future exam invigilation duties.
    
    For admin users, you can help with information about room capacities, faculty availability, and allocation status.
    
    When answering questions, try to be specific and use the context provided. If you don't have the information, politely say so.
    
    Always be professional and helpful.`
  );
};

// Validate message format
const validateMessage = (message) => {
  if (!message || typeof message !== 'string' || message.trim() === '') {
    throw new Error('Invalid message format');
  }
  return true;
};

// Validate chat history format
const validateChatHistory = (chatHistory) => {
  if (!Array.isArray(chatHistory)) {
    return [];
  }
  
  // Filter only valid messages
  return chatHistory.filter(msg => 
    msg && 
    typeof msg === 'object' && 
    (msg.role === 'user' || msg.role === 'assistant') && 
    typeof msg.content === 'string'
  );
};

// Function to generate a response
const generateResponse = async (userInput, chatHistory = [], sessionId = null, userId = null) => {
  try {
    // Validate inputs
    validateMessage(userInput);
    const validatedHistory = validateChatHistory(chatHistory);
    
    // Initialize the knowledge base if not initialized
    if (!knowledgeBase.vectorStore) {
      await knowledgeBase.initialize();
    }
    
    // Query the knowledge base for relevant context
    const relevantDocs = await knowledgeBase.query(userInput);
    const context = formatDocumentsAsString(relevantDocs);
    
    // Create messages array
    const messages = [createSystemMessage()];
    
    // Add context message if available
    if (context) {
      messages.push(new SystemMessage(
        `Here is some relevant information that might help answer the user's question:\n${context}`
      ));
    }
    
    // Add chat history
    for (const message of validatedHistory) {
      if (message.role === 'user') {
        messages.push(new HumanMessage(message.content));
      } else if (message.role === 'assistant') {
        messages.push(new AIMessage(message.content));
      }
    }
    
    // Add current user input
    messages.push(new HumanMessage(userInput));
    
    // Create model
    const model = initChatModel();
    
    // Generate response
    const response = await model.invoke(messages);
    const responseContent = response.content;
    
    // Save conversation if sessionId is provided
    if (sessionId) {
      await conversationService.addMessage(sessionId, 'user', userInput, userId);
      await conversationService.addMessage(sessionId, 'assistant', responseContent, userId);
    }
    
    return responseContent;
  } catch (error) {
    console.error('Error generating response:', error);
    throw error;
  }
};

module.exports = { generateResponse };
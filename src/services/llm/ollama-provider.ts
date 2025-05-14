import axios from 'axios';
import * as https from 'https';
import { LLMProvider, LLMUtils, ChatMessage } from './llm-provider';

/**
 * Configuration for OllamaProvider
 */
export interface OllamaConfig {
  /** Ollama API endpoint URL */
  endpoint: string;
  
  /** Model name to use */
  model: string;
  
  /** Maximum tokens to generate in the response */
  maxTokens?: number;
  
  /** Sampling temperature (0.0-2.0, lower is more deterministic) */
  temperature?: number;
  
  /** Top-p sampling (0.0-1.0) */
  topP?: number;
  
  /** Ignore SSL certificate errors (for local development) */
  ignoreSSLErrors?: boolean;
  
  /** System message for chat context */
  systemMessage?: string;
}

/**
 * Implementation of LLMProvider for Ollama
 */
export class OllamaProvider implements LLMProvider {
  private config: OllamaConfig;
  private httpsAgent?: https.Agent;
  
  /**
   * Create an Ollama provider instance
   * @param config Configuration for the Ollama provider
   */
  constructor(config: OllamaConfig) {
    this.config = {
      endpoint: 'http://localhost:11434',
      model: 'codellama',
      maxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
      ignoreSSLErrors: false,
      ...config
    };
    
    // Create HTTPS agent with SSL certificate validation disabled if needed
    if (this.config.ignoreSSLErrors) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });
    }
  }
  
  /**
   * Get a completion response from Ollama
   * @param prompt The main prompt to send to Ollama
   * @param context Optional context messages to provide before the prompt
   * @returns Promise with Ollama's text response
   */
  async getChatCompletion(prompt: string, context: string[] = []): Promise<string> {
    try {
      const messages = this.prepareChatMessages(prompt, context);
      
      // Format request for Ollama
      const requestData = {
        model: this.config.model,
        messages,
        options: {
          num_predict: this.config.maxTokens,
          temperature: this.config.temperature,
          top_p: this.config.topP
        }
      };
      
      const response = await axios.post(
        `${this.config.endpoint}/api/chat`,
        requestData,
        {
          httpsAgent: this.httpsAgent
        }
      );
      
      return response.data.message.content;
    } catch (error) {
      console.error('Error getting completion from Ollama:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data}`);
      } else {
        throw new Error(`Failed to get completion from Ollama: ${error}`);
      }
    }
  }
  
  /**
   * Get a streamed completion response from Ollama
   * @param prompt The main prompt to send to Ollama
   * @param context Optional context messages to provide before the prompt
   * @returns AsyncGenerator that yields chunks of Ollama's text response
   */
  async *streamChatCompletion(prompt: string, context: string[] = []): AsyncGenerator<string> {
    try {
      const messages = this.prepareChatMessages(prompt, context);
      
      // Format request for Ollama
      const requestData = {
        model: this.config.model,
        messages,
        stream: true,
        options: {
          num_predict: this.config.maxTokens,
          temperature: this.config.temperature,
          top_p: this.config.topP
        }
      };
      
      const response = await axios.post(
        `${this.config.endpoint}/api/chat`,
        requestData,
        {
          responseType: 'stream',
          httpsAgent: this.httpsAgent
        }
      );
      
      // Process the stream
      const stream = response.data;
      
      // Buffer to store partial JSON
      let buffer = '';
      
      // Process the stream as raw data
      for await (const chunk of stream) {
        // Add the chunk to the buffer
        buffer += chunk.toString();
        
        // Process complete JSON objects in the buffer
        let jsonStartIndex;
        while ((jsonStartIndex = buffer.indexOf('{')) !== -1) {
          const jsonEndIndex = buffer.indexOf('}', jsonStartIndex);
          if (jsonEndIndex === -1) break; // Incomplete JSON object
          
          // Extract the JSON object
          const jsonStr = buffer.substring(jsonStartIndex, jsonEndIndex + 1);
          buffer = buffer.substring(jsonEndIndex + 1);
          
          try {
            // Parse the JSON object
            const data = JSON.parse(jsonStr);
            
            // Check if it's a message chunk
            if (data.message && data.message.content) {
              yield data.message.content;
            }
          } catch (err) {
            console.warn('Failed to parse JSON from Ollama stream:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error streaming completion from Ollama:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data}`);
      } else {
        throw new Error(`Failed to stream completion from Ollama: ${error}`);
      }
    }
  }
  
  /**
   * Get vector embeddings for text
   * @param text Text to embed
   * @returns Promise with embedding vector
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        `${this.config.endpoint}/api/embeddings`,
        {
          model: this.config.model,
          prompt: text
        },
        {
          httpsAgent: this.httpsAgent
        }
      );
      
      return response.data.embedding;
    } catch (error) {
      console.error('Error getting embeddings from Ollama:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Ollama API error: ${error.response.status} - ${error.response.data}`);
      } else {
        throw new Error(`Failed to get embeddings from Ollama: ${error}`);
      }
    }
  }
  
  /**
   * Estimate token count for text
   * @param text Text to count tokens for
   * @returns Estimated token count
   */
  estimateTokenCount(text: string): number {
    // Use the utility function for a rough estimate
    return LLMUtils.estimateTokenCount(text);
  }
  
  /**
   * Prepare chat messages for Ollama's format
   * @param prompt Main prompt
   * @param context Context messages
   * @returns Formatted messages for Ollama API
   */
  private prepareChatMessages(prompt: string, context: string[]): any[] {
    // Format messages for Ollama's chat API
    const messages: any[] = [];
    
    // Add system message if provided
    if (this.config.systemMessage) {
      messages.push({
        role: 'system',
        content: this.config.systemMessage
      });
    }
    
    // Add context as user/assistant pairs
    for (let i = 0; i < context.length; i++) {
      // Alternate between user and assistant roles for context
      const role = i % 2 === 0 ? 'user' : 'assistant';
      messages.push({
        role,
        content: context[i]
      });
    }
    
    // Add the main prompt as a user message
    messages.push({
      role: 'user',
      content: prompt
    });
    
    return messages;
  }
}
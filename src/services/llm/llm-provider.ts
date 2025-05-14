/**
 * Base interface for LLM providers
 */
export interface LLMProvider {
  /**
   * Get a completion response for a prompt with optional context
   * @param prompt The main prompt to send to the LLM
   * @param context Optional context messages to provide before the prompt
   * @returns Promise with the LLM's text response
   */
  getChatCompletion(prompt: string, context: string[]): Promise<string>;
  
  /**
   * Get a streamed completion response for a prompt with optional context
   * @param prompt The main prompt to send to the LLM
   * @param context Optional context messages to provide before the prompt
   * @returns AsyncGenerator that yields chunks of the LLM's text response
   */
  streamChatCompletion(prompt: string, context: string[]): AsyncGenerator<string>;
  
  /**
   * Optional: Get vector embeddings for a text input
   * @param text Text to embed
   * @returns Promise with the embedding vector
   */
  getEmbedding?(text: string): Promise<number[]>;
  
  /**
   * Optional: Tokenize text according to the model's tokenizer
   * @param text Text to tokenize
   * @returns Promise with array of token IDs
   */
  tokenize?(text: string): Promise<number[]>;
  
  /**
   * Optional: Estimate token count for billing/context management
   * @param text Text to count tokens for
   * @returns Estimated token count
   */
  estimateTokenCount?(text: string): number;
}

/**
 * Common configuration options for all LLM providers
 */
export interface LLMConfig {
  /** Maximum tokens to generate in the response */
  maxTokens?: number;
  
  /** Sampling temperature (0.0-2.0, lower is more deterministic) */
  temperature?: number;
  
  /** Top-p sampling (0.0-1.0) */
  topP?: number;
  
  /** Presence penalty (-2.0 to 2.0) */
  presencePenalty?: number;
  
  /** Frequency penalty (-2.0 to 2.0) */
  frequencyPenalty?: number;
  
  /** Stop sequences to end generation */
  stopSequences?: string[];
  
  /** System message that sets the behavior of the assistant */
  systemMessage?: string;
}

/**
 * Factory for creating LLM providers based on configuration
 */
export class LLMProviderFactory {
  /**
   * Create an LLM provider based on type and configuration
   * @param type Type of LLM provider
   * @param config Provider-specific configuration
   * @returns LLMProvider implementation
   */
  static create(type: 'azure' | 'ollama' | 'llamacpp' | 'openai', config: Record<string, any>): LLMProvider {
    switch (type) {
      case 'azure':
        // Dynamic import to avoid loading Azure dependencies if not needed
        return new (require('./azure-provider').AzureLLMProvider)(config);
      case 'ollama':
        return new (require('./ollama-provider').OllamaProvider)(config);
      case 'llamacpp':
        return new (require('./llamacpp-provider').LlamaCppProvider)(config);
      case 'openai':
        return new (require('./openai-provider').OpenAIProvider)(config);
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
}

/**
 * Format messages for common chat models
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Helper functions for working with LLMs
 */
export class LLMUtils {
  /**
   * Convert an array of context strings and a prompt into a well-formed message array
   * @param context Array of context strings
   * @param prompt Main prompt
   * @param systemMessage Optional system message
   * @returns Array of ChatMessage objects
   */
  static formatMessages(context: string[], prompt: string, systemMessage?: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    
    // Add system message if provided
    if (systemMessage) {
      messages.push({
        role: 'system',
        content: systemMessage
      });
    }
    
    // Add context messages as user messages
    for (const ctx of context) {
      messages.push({
        role: 'user',
        content: ctx
      });
    }
    
    // Add the main prompt as a user message
    messages.push({
      role: 'user',
      content: prompt
    });
    
    return messages;
  }
  
  /**
   * Simple token count estimator
   * This is a very rough approximation; different models tokenize differently
   * @param text Text to estimate tokens for
   * @returns Rough token count estimate
   */
  static estimateTokenCount(text: string): number {
    // A very rough approximation: 4 characters per token on average
    return Math.ceil(text.length / 4);
  }
}

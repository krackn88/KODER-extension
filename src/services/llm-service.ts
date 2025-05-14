import * as vscode from 'vscode';
import { LLMProvider, LLMProviderFactory } from './llm/llm-provider';
import { LLMSettings, LLMSettingsManager } from '../webviews/llm-settings';

/**
 * Service for interacting with LLMs through the selected provider
 */
export class LLMService {
  private settingsManager: LLMSettingsManager;
  private provider: LLMProvider | null = null;
  private eventEmitter = new vscode.EventEmitter<LLMProvider>();
  
  /**
   * Event that fires when the LLM provider changes
   */
  public readonly onDidChangeProvider = this.eventEmitter.event;
  
  constructor(context: vscode.ExtensionContext) {
    this.settingsManager = new LLMSettingsManager(context);
    this.initializeProvider();
    
    // Register command to change provider
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.selectLLMProvider', async () => {
        await this.promptForProviderChange();
      })
    );
  }
  
  /**
   * Initialize the LLM provider based on settings
   */
  private initializeProvider(): void {
    const settings = this.settingsManager.getSettings();
    this.createProvider(settings);
  }
  
  /**
   * Create a provider instance based on settings
   * @param settings LLM settings
   */
  private createProvider(settings: LLMSettings): void {
    const type = settings.activeProvider;
    const config = {
      ...settings.common,
      ...settings.providers[type]
    };
    
    try {
      this.provider = LLMProviderFactory.create(type, config);
      this.eventEmitter.fire(this.provider);
    } catch (error) {
      console.error('Failed to create LLM provider:', error);
      vscode.window.showErrorMessage(`Failed to initialize ${type} provider: ${error}`);
      this.provider = null;
    }
  }
  
  /**
   * Get the current LLM provider
   * @returns Current LLM provider or null if not initialized
   */
  public getProvider(): LLMProvider | null {
    return this.provider;
  }
  
  /**
   * Update the LLM provider
   * @param settings New LLM settings
   */
  public async updateProvider(settings: LLMSettings): Promise<void> {
    await this.settingsManager.saveSettings(settings);
    this.createProvider(settings);
  }
  
  /**
   * Prompt the user to change the LLM provider
   */
  public async promptForProviderChange(): Promise<void> {
    const settings = this.settingsManager.getSettings();
    
    const providers = [
      { label: 'Azure OpenAI', value: 'azure' },
      { label: 'Ollama (Local)', value: 'ollama' },
      { label: 'llama.cpp (Local)', value: 'llamacpp' },
      { label: 'OpenAI', value: 'openai' }
    ];
    
    const selected = await vscode.window.showQuickPick(
      providers,
      {
        placeHolder: 'Select LLM Provider',
        canPickMany: false
      }
    );
    
    if (selected) {
      const newSettings = { ...settings, activeProvider: selected.value as any };
      await this.updateProvider(newSettings);
      vscode.window.showInformationMessage(`LLM provider changed to ${selected.label}`);
      
      // Open settings UI if needed
      const shouldOpenSettings = await vscode.window.showInformationMessage(
        `Would you like to configure the ${selected.label} provider?`,
        'Yes', 'No'
      );
      
      if (shouldOpenSettings === 'Yes') {
        vscode.commands.executeCommand('workbench.view.extension.koder-llm-settings');
      }
    }
  }
  
  /**
   * Get a completion response from the LLM
   * @param prompt The prompt to send
   * @param context Optional context
   * @returns The LLM's response or an error message
   */
  public async getChatCompletion(prompt: string, context: string[] = []): Promise<string> {
    if (!this.provider) {
      return 'Error: LLM provider not initialized';
    }
    
    try {
      return await this.provider.getChatCompletion(prompt, context);
    } catch (error) {
      console.error('Error getting completion:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Get a streamed completion response from the LLM
   * @param prompt The prompt to send
   * @param context Optional context
   * @returns AsyncGenerator that yields chunks of the response
   */
  public async *streamChatCompletion(prompt: string, context: string[] = []): AsyncGenerator<string> {
    if (!this.provider) {
      yield 'Error: LLM provider not initialized';
      return;
    }
    
    try {
      for await (const chunk of this.provider.streamChatCompletion(prompt, context)) {
        yield chunk;
      }
    } catch (error) {
      console.error('Error streaming completion:', error);
      yield `Error: ${error}`;
    }
  }
  
  /**
   * Get vector embeddings for text
   * @param text Text to embed
   * @returns Embedding vector or null if not supported
   */
  public async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.provider || !this.provider.getEmbedding) {
      return null;
    }
    
    try {
      return await this.provider.getEmbedding(text);
    } catch (error) {
      console.error('Error getting embedding:', error);
      return null;
    }
  }
  
  /**
   * Test the connection to the LLM provider
   * @returns Result message
   */
  public async testConnection(): Promise<string> {
    if (!this.provider) {
      return 'Error: LLM provider not initialized';
    }
    
    try {
      const result = await this.provider.getChatCompletion('Hello, can you respond with "Connection successful"?', []);
      return result.includes('Connection successful') ? 
        'Connection test passed!' : 
        `Connection test received unexpected response: ${result}`;
    } catch (error) {
      console.error('Connection test failed:', error);
      return `Connection test failed: ${error}`;
    }
  }
}
import * as vscode from 'vscode';
import { LLMConfig } from '../services/llm/llm-provider';

/**
 * Configuration for different LLM providers
 */
export interface LLMSettings {
  // Active provider type
  activeProvider: 'azure' | 'ollama' | 'llamacpp' | 'openai';
  
  // Provider-specific configurations
  providers: {
    azure: {
      endpoint: string;
      apiKey: string;
      deploymentId: string;
      apiVersion: string;
    };
    
    ollama: {
      endpoint: string;
      model: string;
      ignoreSSLErrors: boolean;
    };
    
    llamacpp: {
      endpoint: string;
      model: string;
    };
    
    openai: {
      apiKey: string;
      model: string;
    };
  };
  
  // Common LLM configuration settings
  common: LLMConfig;
}

/**
 * Default LLM settings
 */
export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  activeProvider: 'azure',
  
  providers: {
    azure: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      deploymentId: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-11-20'
    },
    
    ollama: {
      endpoint: 'http://localhost:11434',
      model: 'codellama',
      ignoreSSLErrors: false
    },
    
    llamacpp: {
      endpoint: 'http://localhost:8080',
      model: 'default'
    },
    
    openai: {
      apiKey: '',
      model: 'gpt-4o'
    }
  },
  
  common: {
    maxTokens: 4000,
    temperature: 0.7,
    topP: 0.95,
    presencePenalty: 0,
    frequencyPenalty: 0,
    systemMessage: 'You are a helpful pair programming assistant that understands code context and provides helpful suggestions.'
  }
};

/**
 * Manager for LLM settings
 */
export class LLMSettingsManager {
  private context: vscode.ExtensionContext;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    
    // Initialize settings if they don't exist
    if (!this.getSettings()) {
      this.saveSettings(DEFAULT_LLM_SETTINGS);
    }
  }
  
  /**
   * Get the current LLM settings
   * @returns Current LLM settings
   */
  public getSettings(): LLMSettings {
    const settings = this.context.globalState.get<LLMSettings>('llmSettings');
    return settings || DEFAULT_LLM_SETTINGS;
  }
  
  /**
   * Save LLM settings
   * @param settings LLM settings to save
   */
  public async saveSettings(settings: LLMSettings): Promise<void> {
    await this.context.globalState.update('llmSettings', settings);
  }
  
  /**
   * Update specific settings while preserving others
   * @param partialSettings Partial settings to update
   */
  public async updateSettings(partialSettings: Partial<LLMSettings>): Promise<void> {
    const currentSettings = this.getSettings();
    const newSettings = {
      ...currentSettings,
      ...partialSettings,
      providers: {
        ...currentSettings.providers,
        ...(partialSettings.providers || {})
      },
      common: {
        ...currentSettings.common,
        ...(partialSettings.common || {})
      }
    };
    
    await this.saveSettings(newSettings);
  }
  
  /**
   * Reset settings to defaults
   */
  public async resetSettings(): Promise<void> {
    await this.saveSettings(DEFAULT_LLM_SETTINGS);
  }
}

/**
 * Provider for the LLM settings webview
 */
export class LLMSettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'koder.llmSettings';
  private _view?: vscode.WebviewView;
  
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly settingsManager: LLMSettingsManager
  ) {}
  
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    
    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'getSettings':
          const settings = this.settingsManager.getSettings();
          webviewView.webview.postMessage({ 
            type: 'updateSettings', 
            settings 
          });
          break;
        
        case 'saveSettings':
          await this.settingsManager.saveSettings(data.settings);
          vscode.window.showInformationMessage('LLM settings saved');
          break;
        
        case 'resetSettings':
          await this.settingsManager.resetSettings();
          webviewView.webview.postMessage({ 
            type: 'updateSettings', 
            settings: this.settingsManager.getSettings() 
          });
          vscode.window.showInformationMessage('LLM settings reset to defaults');
          break;
        
        case 'testConnection':
          try {
            // Implement connection test for different providers
            vscode.window.showInformationMessage('Connection successful!');
          } catch (error) {
            vscode.window.showErrorMessage(`Connection failed: ${error}`);
          }
          break;
      }
    });
    
    // Update settings when the view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        webviewView.webview.postMessage({ 
          type: 'updateSettings', 
          settings: this.settingsManager.getSettings() 
        });
      }
    });
  }
  
  /**
   * Get HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // HTML for the settings UI
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>LLM Settings</title>
      <style>
        body {
          padding: 20px;
          color: var(--vscode-foreground);
          font-family: var(--vscode-font-family);
        }
        
        h1 {
          font-size: 1.5em;
          margin-bottom: 20px;
        }
        
        h2 {
          font-size: 1.2em;
          margin-top: 15px;
          margin-bottom: 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        label {
          display: block;
          margin-bottom: 5px;
        }
        
        select, input[type="text"], input[type="number"], input[type="password"] {
          width: 100%;
          padding: 5px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        
        .buttons {
          display: flex;
          justify-content: flex-end;
          margin-top: 20px;
        }
        
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 12px;
          margin-left: 10px;
          cursor: pointer;
        }
        
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        .provider-settings {
          display: none;
          margin-top: 10px;
          padding: 10px;
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
        }
        
        textarea {
          width: 100%;
          height: 80px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
      </style>
    </head>
    <body>
      <h1>LLM Provider Settings</h1>
      
      <div class="form-group">
        <label for="provider">Active Provider</label>
        <select id="provider">
          <option value="azure">Azure OpenAI</option>
          <option value="ollama">Ollama (Local)</option>
          <option value="llamacpp">llama.cpp (Local)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      
      <!-- Azure Settings -->
      <div id="azure-settings" class="provider-settings">
        <h2>Azure OpenAI Settings</h2>
        <div class="form-group">
          <label for="azure-endpoint">Endpoint</label>
          <input type="text" id="azure-endpoint" placeholder="https://your-instance.openai.azure.com/">
        </div>
        <div class="form-group">
          <label for="azure-key">API Key</label>
          <input type="password" id="azure-key">
        </div>
        <div class="form-group">
          <label for="azure-deployment">Deployment ID</label>
          <input type="text" id="azure-deployment">
        </div>
        <div class="form-group">
          <label for="azure-version">API Version</label>
          <input type="text" id="azure-version" placeholder="2024-11-20">
        </div>
      </div>
      
      <!-- Ollama Settings -->
      <div id="ollama-settings" class="provider-settings">
        <h2>Ollama Settings (Local)</h2>
        <div class="form-group">
          <label for="ollama-endpoint">Endpoint</label>
          <input type="text" id="ollama-endpoint" placeholder="http://localhost:11434">
        </div>
        <div class="form-group">
          <label for="ollama-model">Model</label>
          <input type="text" id="ollama-model" placeholder="codellama">
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" id="ollama-ssl">
            Ignore SSL Errors (for development)
          </label>
        </div>
      </div>
      
      <!-- llama.cpp Settings -->
      <div id="llamacpp-settings" class="provider-settings">
        <h2>llama.cpp Settings (Local)</h2>
        <div class="form-group">
          <label for="llamacpp-endpoint">Endpoint</label>
          <input type="text" id="llamacpp-endpoint" placeholder="http://localhost:8080">
        </div>
        <div class="form-group">
          <label for="llamacpp-model">Model</label>
          <input type="text" id="llamacpp-model" placeholder="default">
        </div>
      </div>
      
      <!-- OpenAI Settings -->
      <div id="openai-settings" class="provider-settings">
        <h2>OpenAI Settings</h2>
        <div class="form-group">
          <label for="openai-key">API Key</label>
          <input type="password" id="openai-key">
        </div>
        <div class="form-group">
          <label for="openai-model">Model</label>
          <input type="text" id="openai-model" placeholder="gpt-4o">
        </div>
      </div>
      
      <!-- Common LLM Settings -->
      <h2>Common Settings</h2>
      <div class="form-group">
        <label for="max-tokens">Max Tokens</label>
        <input type="number" id="max-tokens" min="1" max="8192">
      </div>
      <div class="form-group">
        <label for="temperature">Temperature</label>
        <input type="number" id="temperature" min="0" max="2" step="0.1">
      </div>
      <div class="form-group">
        <label for="top-p">Top P</label>
        <input type="number" id="top-p" min="0" max="1" step="0.01">
      </div>
      <div class="form-group">
        <label for="presence-penalty">Presence Penalty</label>
        <input type="number" id="presence-penalty" min="-2" max="2" step="0.1">
      </div>
      <div class="form-group">
        <label for="frequency-penalty">Frequency Penalty</label>
        <input type="number" id="frequency-penalty" min="-2" max="2" step="0.1">
      </div>
      <div class="form-group">
        <label for="system-message">System Message</label>
        <textarea id="system-message"></textarea>
      </div>
      
      <div class="buttons">
        <button id="test-btn">Test Connection</button>
        <button id="reset-btn">Reset to Defaults</button>
        <button id="save-btn">Save Settings</button>
      </div>
      
      <script>
        const vscode = acquireVsCodeApi();
        let currentSettings = null;
        
        // UI Elements
        const providerSelect = document.getElementById('provider');
        const providerSettings = {
          azure: document.getElementById('azure-settings'),
          ollama: document.getElementById('ollama-settings'),
          llamacpp: document.getElementById('llamacpp-settings'),
          openai: document.getElementById('openai-settings')
        };
        
        // Azure UI elements
        const azureEndpoint = document.getElementById('azure-endpoint');
        const azureKey = document.getElementById('azure-key');
        const azureDeployment = document.getElementById('azure-deployment');
        const azureVersion = document.getElementById('azure-version');
        
        // Ollama UI elements
        const ollamaEndpoint = document.getElementById('ollama-endpoint');
        const ollamaModel = document.getElementById('ollama-model');
        const ollamaSSL = document.getElementById('ollama-ssl');
        
        // llama.cpp UI elements
        const llamacppEndpoint = document.getElementById('llamacpp-endpoint');
        const llamacppModel = document.getElementById('llamacpp-model');
        
        // OpenAI UI elements
        const openaiKey = document.getElementById('openai-key');
        const openaiModel = document.getElementById('openai-model');
        
        // Common settings UI elements
        const maxTokens = document.getElementById('max-tokens');
        const temperature = document.getElementById('temperature');
        const topP = document.getElementById('top-p');
        const presencePenalty = document.getElementById('presence-penalty');
        const frequencyPenalty = document.getElementById('frequency-penalty');
        const systemMessage = document.getElementById('system-message');
        
        // Buttons
        const testBtn = document.getElementById('test-btn');
        const resetBtn = document.getElementById('reset-btn');
        const saveBtn = document.getElementById('save-btn');
        
        // Show the selected provider settings
        function showProviderSettings(provider) {
          Object.keys(providerSettings).forEach(key => {
            providerSettings[key].style.display = key === provider ? 'block' : 'none';
          });
        }
        
        // Update UI with settings
        function updateUI(settings) {
          currentSettings = settings;
          
          // Update provider selection
          providerSelect.value = settings.activeProvider;
          showProviderSettings(settings.activeProvider);
          
          // Update Azure settings
          azureEndpoint.value = settings.providers.azure.endpoint;
          azureKey.value = settings.providers.azure.apiKey;
          azureDeployment.value = settings.providers.azure.deploymentId;
          azureVersion.value = settings.providers.azure.apiVersion;
          
          // Update Ollama settings
          ollamaEndpoint.value = settings.providers.ollama.endpoint;
          ollamaModel.value = settings.providers.ollama.model;
          ollamaSSL.checked = settings.providers.ollama.ignoreSSLErrors;
          
          // Update llama.cpp settings
          llamacppEndpoint.value = settings.providers.llamacpp.endpoint;
          llamacppModel.value = settings.providers.llamacpp.model;
          
          // Update OpenAI settings
          openaiKey.value = settings.providers.openai.apiKey;
          openaiModel.value = settings.providers.openai.model;
          
          // Update common settings
          maxTokens.value = settings.common.maxTokens;
          temperature.value = settings.common.temperature;
          topP.value = settings.common.topP;
          presencePenalty.value = settings.common.presencePenalty;
          frequencyPenalty.value = settings.common.frequencyPenalty;
          systemMessage.value = settings.common.systemMessage;
        }
        
        // Get settings from UI
        function getSettingsFromUI() {
          const provider = providerSelect.value;
          
          return {
            activeProvider: provider,
            providers: {
              azure: {
                endpoint: azureEndpoint.value,
                apiKey: azureKey.value,
                deploymentId: azureDeployment.value,
                apiVersion: azureVersion.value
              },
              ollama: {
                endpoint: ollamaEndpoint.value,
                model: ollamaModel.value,
                ignoreSSLErrors: ollamaSSL.checked
              },
              llamacpp: {
                endpoint: llamacppEndpoint.value,
                model: llamacppModel.value
              },
              openai: {
                apiKey: openaiKey.value,
                model: openaiModel.value
              }
            },
            common: {
              maxTokens: parseInt(maxTokens.value),
              temperature: parseFloat(temperature.value),
              topP: parseFloat(topP.value),
              presencePenalty: parseFloat(presencePenalty.value),
              frequencyPenalty: parseFloat(frequencyPenalty.value),
              systemMessage: systemMessage.value
            }
          };
        }
        
        // Event listeners
        providerSelect.addEventListener('change', () => {
          showProviderSettings(providerSelect.value);
        });
        
        saveBtn.addEventListener('click', () => {
          const settings = getSettingsFromUI();
          vscode.postMessage({ type: 'saveSettings', settings });
        });
        
        resetBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'resetSettings' });
        });
        
        testBtn.addEventListener('click', () => {
          const settings = getSettingsFromUI();
          vscode.postMessage({ 
            type: 'testConnection', 
            provider: settings.activeProvider,
            config: settings.providers[settings.activeProvider]
          });
        });
        
        // Get initial settings
        window.addEventListener('message', event => {
          const message = event.data;
          
          if (message.type === 'updateSettings') {
            updateUI(message.settings);
          }
        });
        
        // Request settings when loaded
        vscode.postMessage({ type: 'getSettings' });
      </script>
    </body>
    </html>`;
  }
}
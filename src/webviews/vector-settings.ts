import * as vscode from 'vscode';
import { VectorServiceConfig, DEFAULT_VECTOR_SERVICE_CONFIG } from '../services/vector-service';
import { VectorService } from '../services/vector-service';

/**
 * Provider for the vector settings webview
 */
export class VectorSettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'koder.vectorSettings';
  private _view?: vscode.WebviewView;
  
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly vectorService?: VectorService
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
          const settings = this.getSettings();
          webviewView.webview.postMessage({ 
            type: 'updateSettings', 
            settings 
          });
          
          // Get vector store stats if available
          if (this.vectorService) {
            try {
              const stats = await this.vectorService.getStats();
              webviewView.webview.postMessage({ 
                type: 'updateStats', 
                stats 
              });
            } catch (error) {
              console.error('Error getting vector stats:', error);
            }
          }
          break;
        
        case 'saveSettings':
          await this.saveSettings(data.settings);
          vscode.window.showInformationMessage('Vector settings saved. Restart the extension to apply changes.');
          break;
        
        case 'resetSettings':
          await this.resetSettings();
          webviewView.webview.postMessage({ 
            type: 'updateSettings', 
            settings: DEFAULT_VECTOR_SERVICE_CONFIG 
          });
          vscode.window.showInformationMessage('Vector settings reset to defaults');
          break;
          
        case 'clearVectorStore':
          if (this.vectorService) {
            try {
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Clearing vector store...',
                cancellable: false
              }, async () => {
                await this.vectorService?.clear();
                const stats = await this.vectorService?.getStats();
                webviewView.webview.postMessage({ 
                  type: 'updateStats', 
                  stats 
                });
              });
              vscode.window.showInformationMessage('Vector store cleared successfully');
            } catch (error) {
              vscode.window.showErrorMessage(`Error clearing vector store: ${error}`);
            }
          } else {
            vscode.window.showErrorMessage('Vector service not available');
          }
          break;
          
        case 'embedWorkspace':
          vscode.commands.executeCommand('koder.embedWorkspace');
          break;
      }
    });
    
    // Update settings when the view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        webviewView.webview.postMessage({ 
          type: 'updateSettings', 
          settings: this.getSettings() 
        });
        
        // Get vector store stats
        if (this.vectorService) {
          this.vectorService.getStats().then(stats => {
            webviewView.webview.postMessage({ 
              type: 'updateStats', 
              stats 
            });
          }).catch(console.error);
        }
      }
    });
  }
  
  /**
   * Get vector service settings
   */
  private getSettings(): VectorServiceConfig {
    const settings = this.context.globalState.get<VectorServiceConfig>('vectorServiceConfig');
    return settings || DEFAULT_VECTOR_SERVICE_CONFIG;
  }
  
  /**
   * Save vector service settings
   */
  private async saveSettings(settings: VectorServiceConfig): Promise<void> {
    await this.context.globalState.update('vectorServiceConfig', settings);
  }
  
  /**
   * Reset vector service settings to defaults
   */
  private async resetSettings(): Promise<void> {
    await this.context.globalState.update('vectorServiceConfig', DEFAULT_VECTOR_SERVICE_CONFIG);
  }
  
  /**
   * Get HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vector Settings</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 20px;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
        }
        
        h1 {
          font-size: 1.5em;
          margin-bottom: 20px;
        }
        
        h2 {
          font-size: 1.2em;
          margin-top: 15px;
          margin-bottom: 10px;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 5px;
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        label {
          display: block;
          margin-bottom: 5px;
        }
        
        select, input[type="text"], input[type="number"] {
          width: 100%;
          padding: 5px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        
        input[type="checkbox"] {
          margin-right: 5px;
        }
        
        .button-container {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
        }
        
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 12px;
          cursor: pointer;
          margin-left: 10px;
        }
        
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        .stats-container {
          margin-top: 20px;
          padding: 10px;
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 5px;
        }
        
        .stats-title {
          font-weight: bold;
          margin-bottom: 5px;
        }
        
        .stats-item {
          margin: 5px 0;
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        
        .action-btn {
          margin-top: 5px;
          margin-right: 5px;
        }
      </style>
    </head>
    <body>
      <h1>Vector Database Settings</h1>
      
      <div class="form-group">
        <label for="vectorStoreType">Vector Store Type</label>
        <select id="vectorStoreType">
          <option value="memory">In-Memory (Development)</option>
          <option value="sqlite">SQLite (Default)</option>
          <option value="qdrant">Qdrant (Advanced)</option>
        </select>
      </div>
      
      <div class="form-group">
        <label for="dimensions">Vector Dimensions</label>
        <input type="number" id="dimensions" min="16" max="1536" value="384">
        <small>Higher dimensions = more accurate but slower, more memory</small>
      </div>
      
      <h2>Text Chunking</h2>
      
      <div class="form-group">
        <label for="defaultChunkSize">Chunk Size (characters)</label>
        <input type="number" id="defaultChunkSize" min="256" max="8192" value="1024">
      </div>
      
      <div class="form-group">
        <label for="defaultChunkOverlap">Chunk Overlap (characters)</label>
        <input type="number" id="defaultChunkOverlap" min="0" max="1024" value="200">
      </div>
      
      <div class="form-group">
        <label>
          <input type="checkbox" id="enableAutoEmbedding">
          Enable auto-embedding for saved documents
        </label>
      </div>
      
      <div class="stats-container" id="stats-container" style="display: none;">
        <div class="stats-title">Vector Store Statistics</div>
        <div id="stats-content"></div>
        
        <div style="margin-top: 10px;">
          <button id="embedWorkspaceBtn" class="action-btn">Embed Workspace</button>
          <button id="clearStoreBtn" class="action-btn">Clear Vector Store</button>
        </div>
      </div>
      
      <div class="button-container">
        <button id="resetBtn">Reset to Defaults</button>
        <button id="saveBtn">Save Settings</button>
      </div>
      
      <script>
        // Get VS Code API
        const vscode = acquireVsCodeApi();
        
        // DOM elements
        const vectorStoreTypeEl = document.getElementById('vectorStoreType');
        const dimensionsEl = document.getElementById('dimensions');
        const defaultChunkSizeEl = document.getElementById('defaultChunkSize');
        const defaultChunkOverlapEl = document.getElementById('defaultChunkOverlap');
        const enableAutoEmbeddingEl = document.getElementById('enableAutoEmbedding');
        const statsContainerEl = document.getElementById('stats-container');
        const statsContentEl = document.getElementById('stats-content');
        const embedWorkspaceBtn = document.getElementById('embedWorkspaceBtn');
        const clearStoreBtn = document.getElementById('clearStoreBtn');
        const resetBtn = document.getElementById('resetBtn');
        const saveBtn = document.getElementById('saveBtn');
        
        // Format bytes to human-readable size
        function formatBytes(bytes, decimals = 2) {
          if (bytes === 0) return '0 Bytes';
          
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          
          return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }
        
        // Update UI with settings
        function updateUI(settings) {
          vectorStoreTypeEl.value = settings.vectorStoreType;
          dimensionsEl.value = settings.dimensions;
          defaultChunkSizeEl.value = settings.defaultChunkSize;
          defaultChunkOverlapEl.value = settings.defaultChunkOverlap;
          enableAutoEmbeddingEl.checked = settings.enableAutoEmbedding;
        }
        
        // Update stats display
        function updateStats(stats) {
          if (!stats) {
            statsContainerEl.style.display = 'none';
            return;
          }
          
          statsContainerEl.style.display = 'block';
          
          let content = '';
          
          // Add count
          content += '<div class="stats-item">Vectors: ' + stats.count + '</div>';
          
          // Add dimensions
          content += '<div class="stats-item">Dimensions: ' + stats.dimensions + '</div>';
          
          // Add storage type
          content += '<div class="stats-item">Type: ' + vectorStoreTypeEl.value + '</div>';
          
          // Add size if available
          if (stats.dbSize) {
            content += '<div class="stats-item">Database Size: ' + formatBytes(stats.dbSize) + '</div>';
          } else if (stats.memoryUsage) {
            content += '<div class="stats-item">Memory Usage: ' + formatBytes(stats.memoryUsage) + '</div>';
          }
          
          statsContentEl.innerHTML = content;
        }
        
        // Get settings from UI
        function getSettingsFromUI() {
          return {
            vectorStoreType: vectorStoreTypeEl.value,
            dimensions: parseInt(dimensionsEl.value),
            defaultChunkSize: parseInt(defaultChunkSizeEl.value),
            defaultChunkOverlap: parseInt(defaultChunkOverlapEl.value),
            enableAutoEmbedding: enableAutoEmbeddingEl.checked
          };
        }
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
          const message = event.data;
          
          switch (message.type) {
            case 'updateSettings':
              updateUI(message.settings);
              break;
              
            case 'updateStats':
              updateStats(message.stats);
              break;
          }
        });
        
        // Save settings
        saveBtn.addEventListener('click', () => {
          const settings = getSettingsFromUI();
          vscode.postMessage({
            type: 'saveSettings',
            settings
          });
        });
        
        // Reset settings
        resetBtn.addEventListener('click', () => {
          vscode.postMessage({
            type: 'resetSettings'
          });
        });
        
        // Embed workspace
        embedWorkspaceBtn.addEventListener('click', () => {
          vscode.postMessage({
            type: 'embedWorkspace'
          });
        });
        
        // Clear vector store
        clearStoreBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to clear the vector store? This will delete all embeddings.')) {
            vscode.postMessage({
              type: 'clearVectorStore'
            });
          }
        });
        
        // Request current settings when loaded
        vscode.postMessage({
          type: 'getSettings'
        });
      </script>
    </body>
    </html>`;
  }
}
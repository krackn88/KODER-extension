import * as vscode from 'vscode';
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from '../core/auto-approval';

/**
 * Provider for the auto-approval settings webview
 */
export class AutoApprovalSettingsProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'koder.autoApprovalSettings';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Enable JavaScript in the webview
      enableScripts: true,
      // Restrict the webview to only load resources from the extension's directory
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'saveSettings':
          await this.saveSettings(data.settings);
          vscode.window.showInformationMessage('KODER auto-approval settings saved');
          break;
        case 'resetSettings':
          await this.resetSettings();
          vscode.window.showInformationMessage('KODER auto-approval settings reset to defaults');
          // Update the webview with the default settings
          webviewView.webview.postMessage({
            type: 'updateSettings',
            settings: DEFAULT_AUTO_APPROVAL_SETTINGS
          });
          break;
        case 'getSettings':
          const settings = await this.loadSettings();
          webviewView.webview.postMessage({
            type: 'updateSettings',
            settings
          });
          break;
      }
    });

    // Load settings when the view is shown
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.loadSettings().then(settings => {
          webviewView.webview.postMessage({
            type: 'updateSettings',
            settings
          });
        });
      }
    });
  }

  /**
   * Load auto-approval settings from global state
   */
  private async loadSettings(): Promise<AutoApprovalSettings> {
    const settings = this._context.globalState.get<AutoApprovalSettings>('autoApprovalSettings');
    return settings || DEFAULT_AUTO_APPROVAL_SETTINGS;
  }

  /**
   * Save auto-approval settings to global state
   */
  private async saveSettings(settings: AutoApprovalSettings): Promise<void> {
    // Update version
    settings.version = (settings.version || 0) + 1;
    await this._context.globalState.update('autoApprovalSettings', settings);
  }

  /**
   * Reset auto-approval settings to defaults
   */
  private async resetSettings(): Promise<void> {
    await this._context.globalState.update('autoApprovalSettings', DEFAULT_AUTO_APPROVAL_SETTINGS);
  }

  /**
   * Get the HTML for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Auto-Approval Settings</title>
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
        input[type="text"], input[type="number"] {
          width: 100%;
          padding: 5px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
        }
        input[type="checkbox"] {
          margin-right: 5px;
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 12px;
          cursor: pointer;
          margin-right: 10px;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        textarea {
          width: 100%;
          height: 80px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          padding: 5px;
        }
        .button-container {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
        }
      </style>
    </head>
    <body>
      <h1>KODER Auto-Approval Settings</h1>
      
      <h2>Terminal Commands</h2>
      <div class="form-group">
        <label>
          <input type="checkbox" id="autoApproveTerminalCommands"> 
          Auto-approve safe terminal commands
        </label>
      </div>
      <div class="form-group">
        <label>Maximum terminal commands per session</label>
        <input type="number" id="maximumTerminalCommands" min="1" max="100">
      </div>
      <div class="form-group">
        <label>Safe terminal commands (comma separated)</label>
        <textarea id="safeTerminalCommands"></textarea>
      </div>
      
      <h2>File Operations</h2>
      <div class="form-group">
        <label>
          <input type="checkbox" id="autoApproveFileCreation"> 
          Auto-approve creation of safe file types
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" id="autoApproveFileEdits"> 
          Auto-approve edits to safe file types
        </label>
      </div>
      <div class="form-group">
        <label>Maximum file operations per session</label>
        <input type="number" id="maximumFileOperations" min="1" max="100">
      </div>
      <div class="form-group">
        <label>Safe file extensions (comma separated)</label>
        <textarea id="safeFileExtensions"></textarea>
      </div>
      
      <h2>API Limits</h2>
      <div class="form-group">
        <label>Maximum API calls per session</label>
        <input type="number" id="maximumApiCalls" min="1" max="100">
      </div>
      <div class="form-group">
        <label>API token budget per session</label>
        <input type="number" id="apiCallBudget" min="1000" max="1000000" step="1000">
      </div>
      
      <h2>Session Limits</h2>
      <div class="form-group">
        <label>Maximum session duration (minutes, 0 for unlimited)</label>
        <input type="number" id="maximumSessionDuration" min="0" max="360">
      </div>
      
      <div class="button-container">
        <button id="resetBtn">Reset to Defaults</button>
        <button id="saveBtn">Save Settings</button>
      </div>
      
      <script>
        const vscode = acquireVsCodeApi();
        
        // DOM elements
        const autoApproveTerminalCommandsEl = document.getElementById('autoApproveTerminalCommands');
        const maximumTerminalCommandsEl = document.getElementById('maximumTerminalCommands');
        const safeTerminalCommandsEl = document.getElementById('safeTerminalCommands');
        const autoApproveFileCreationEl = document.getElementById('autoApproveFileCreation');
        const autoApproveFileEditsEl = document.getElementById('autoApproveFileEdits');
        const maximumFileOperationsEl = document.getElementById('maximumFileOperations');
        const safeFileExtensionsEl = document.getElementById('safeFileExtensions');
        const maximumApiCallsEl = document.getElementById('maximumApiCalls');
        const apiCallBudgetEl = document.getElementById('apiCallBudget');
        const maximumSessionDurationEl = document.getElementById('maximumSessionDuration');
        const saveBtn = document.getElementById('saveBtn');
        const resetBtn = document.getElementById('resetBtn');
        
        // Load settings
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type === 'updateSettings') {
            const settings = message.settings;
            updateFormWithSettings(settings);
          }
        });
        
        // Request current settings when loaded
        vscode.postMessage({ type: 'getSettings' });
        
        // Update form with settings
        function updateFormWithSettings(settings) {
          autoApproveTerminalCommandsEl.checked = settings.autoApproveTerminalCommands;
          maximumTerminalCommandsEl.value = settings.maximumTerminalCommands;
          safeTerminalCommandsEl.value = settings.safeTerminalCommands.join(', ');
          
          autoApproveFileCreationEl.checked = settings.autoApproveFileCreation;
          autoApproveFileEditsEl.checked = settings.autoApproveFileEdits;
          maximumFileOperationsEl.value = settings.maximumFileOperations;
          safeFileExtensionsEl.value = settings.safeFileExtensions.join(', ');
          
          maximumApiCallsEl.value = settings.maximumApiCalls;
          apiCallBudgetEl.value = settings.apiCallBudget;
          
          maximumSessionDurationEl.value = settings.maximumSessionDuration;
        }
        
        // Save settings
        saveBtn.addEventListener('click', () => {
          // Convert form values to settings object
          const settings = {
            // Keep the current version
            version: 0, // This will be incremented when saved
            
            // Terminal commands
            autoApproveTerminalCommands: autoApproveTerminalCommandsEl.checked,
            maximumTerminalCommands: parseInt(maximumTerminalCommandsEl.value),
            safeTerminalCommands: safeTerminalCommandsEl.value.split(',').map(cmd => cmd.trim()),
            
            // File operations
            autoApproveFileCreation: autoApproveFileCreationEl.checked,
            autoApproveFileEdits: autoApproveFileEditsEl.checked,
            maximumFileOperations: parseInt(maximumFileOperationsEl.value),
            safeFileExtensions: safeFileExtensionsEl.value.split(',').map(ext => ext.trim()),
            
            // Browser operations (not editable in UI yet)
            autoApproveBrowserOperations: false,
            maximumBrowserOperations: 5,
            safeBrowserDomains: ['localhost', '127.0.0.1'],
            
            // API limits
            maximumApiCalls: parseInt(maximumApiCallsEl.value),
            apiCallBudget: parseInt(apiCallBudgetEl.value),
            
            // Session limits
            maximumSessionDuration: parseInt(maximumSessionDurationEl.value)
          };
          
          // Send settings to extension
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
      </script>
    </body>
    </html>`;
  }
}
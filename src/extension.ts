import * as vscode from 'vscode';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { CodebaseIndexer } from './core/indexer';
import { MemoryManager } from './core/memory';
import { Task } from './core/task';
import { AzureClient } from './services/azure';
import { VSCodeIntegration } from './vscode/integration';
import { DiffViewProvider, DIFF_VIEW_URI_SCHEME } from './integrations/editor/diff-view-provider';
import { AutoApprovalSettingsProvider } from './webviews/auto-approval-settings';
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from './core/auto-approval';
import { LLMSettingsViewProvider, LLMSettingsManager } from './webviews/llm-settings';
import { LLMService } from './services/llm-service';
import { VectorSettingsViewProvider } from './webviews/vector-settings';
import { VectorService, VectorServiceConfig, DEFAULT_VECTOR_SERVICE_CONFIG } from './services/vector-service';

// Load environment variables
dotenv.config();

export async function activate(context: vscode.ExtensionContext) {
  console.log('KODER is now active!');
  const outputChannel = vscode.window.createOutputChannel("KODER");
  context.subscriptions.push(outputChannel);
  
  // Initialize auto-approval settings if they don't exist
  if (!context.globalState.get<AutoApprovalSettings>('autoApprovalSettings')) {
    await context.globalState.update('autoApprovalSettings', DEFAULT_AUTO_APPROVAL_SETTINGS);
  }
  
  // Initialize vector service settings if they don't exist
  if (!context.globalState.get<VectorServiceConfig>('vectorServiceConfig')) {
    await context.globalState.update('vectorServiceConfig', DEFAULT_VECTOR_SERVICE_CONFIG);
  }
  
  try {
    // Initialize LLM service
    const llmService = new LLMService(context);
    
    // Initialize vector service
    const vectorServiceConfig = context.globalState.get<VectorServiceConfig>('vectorServiceConfig') 
      || DEFAULT_VECTOR_SERVICE_CONFIG;
    const vectorService = new VectorService(context, llmService, vectorServiceConfig);
    
    // Initialize services
    const azureClient = new AzureClient();
    const memoryManager = new MemoryManager(azureClient);
    const indexer = new CodebaseIndexer(memoryManager);
    const vscodeIntegration = new VSCodeIntegration(context, memoryManager, indexer);
    
    // Register the diff view provider
    const diffViewProvider = new DiffViewProvider();
    context.subscriptions.push(diffViewProvider);
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        DIFF_VIEW_URI_SCHEME,
        diffViewProvider
      )
    );
    
    // Register the auto-approval settings webview
    const autoApprovalSettingsProvider = new AutoApprovalSettingsProvider(
      context.extensionUri,
      context
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        AutoApprovalSettingsProvider.viewType,
        autoApprovalSettingsProvider
      )
    );
    
    // Register the LLM settings webview
    const llmSettingsManager = new LLMSettingsManager(context);
    const llmSettingsViewProvider = new LLMSettingsViewProvider(
      context.extensionUri,
      llmSettingsManager
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        LLMSettingsViewProvider.viewType,
        llmSettingsViewProvider
      )
    );
    
    // Register the vector settings webview
    const vectorSettingsViewProvider = new VectorSettingsViewProvider(
      context.extensionUri,
      context,
      vectorService
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        VectorSettingsViewProvider.viewType,
        vectorSettingsViewProvider
      )
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.start', () => {
        vscode.window.showInformationMessage('KODER pair programming started');
        vscodeIntegration.start();
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('koder.indexWorkspace', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          vscode.window.showErrorMessage('No workspace folder is open');
          return;
        }

        vscode.window.showInformationMessage('Starting workspace indexing...');
        try {
          await indexer.indexWorkspace(workspaceFolders[0].uri.fsPath);
          vscode.window.showInformationMessage('Workspace indexed successfully');
        } catch (error) {
          vscode.window.showErrorMessage(`Indexing failed: ${error}`);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('koder.ask', async () => {
        const question = await vscode.window.showInputBox({
          prompt: 'What would you like to know about your code?',
          placeHolder: 'e.g., How does the authentication system work?'
        });

        if (question) {
          vscodeIntegration.askQuestion(question);
        }
      })
    );
    
    // Register terminal commands
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.executeCommand', async () => {
        const command = await vscode.window.showInputBox({
          prompt: 'Enter a command to execute',
          placeHolder: 'e.g., npm install'
        });
        
        if (command) {
          // Create a task for this command
          const autoApprovalSettings = context.globalState.get<AutoApprovalSettings>('autoApprovalSettings');
          const task = new Task(context, memoryManager, outputChannel, 
            `Execute command: ${command}`, autoApprovalSettings);
          
          // Execute the command
          await task.executeCommand(command);
          
          // Complete the task
          task.complete();
        }
      })
    );
    
    // Register command to add terminal output to chat
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.addTerminalOutputToChat', async () => {
        const terminals = vscode.window.terminals;
        if (terminals.length === 0) {
          vscode.window.showErrorMessage('No terminals are open');
          return;
        }
        
        // If only one terminal is open, use that
        if (terminals.length === 1) {
          const activeTerminal = terminals[0];
          
          // Create a temporary task to handle the terminal
          const autoApprovalSettings = context.globalState.get<AutoApprovalSettings>('autoApprovalSettings');
          const task = new Task(context, memoryManager, outputChannel, 
            undefined, autoApprovalSettings);
          
          // Get the terminal history
          const history = task.terminalManager.getTerminalHistory(activeTerminal.name);
          
          if (history) {
            vscodeIntegration.addTerminalOutputToChat(history, activeTerminal.name);
          } else {
            vscode.window.showInformationMessage('No terminal output captured yet');
          }
          
          // Clean up task
          task.dispose();
        } else {
          // Multiple terminals open, ask user to pick one
          const terminalNames = terminals.map(t => t.name);
          const selectedTerminal = await vscode.window.showQuickPick(terminalNames, {
            placeHolder: 'Select a terminal to get output from'
          });
          
          if (selectedTerminal) {
            const terminal = terminals.find(t => t.name === selectedTerminal);
            if (terminal) {
              // Create a temporary task to handle the terminal
              const autoApprovalSettings = context.globalState.get<AutoApprovalSettings>('autoApprovalSettings');
              const task = new Task(context, memoryManager, outputChannel, 
                undefined, autoApprovalSettings);
              
              // Get the terminal history
              const history = task.terminalManager.getTerminalHistory(terminal.name);
              
              if (history) {
                vscodeIntegration.addTerminalOutputToChat(history, terminal.name);
              } else {
                vscode.window.showInformationMessage('No terminal output captured yet');
              }
              
              // Clean up task
              task.dispose();
            }
          }
        }
      })
    );
    
    // Register command to open auto-approval settings
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.openAutoApprovalSettings', async () => {
        vscode.commands.executeCommand('workbench.view.extension.koder-sidebar');
        vscode.commands.executeCommand('koder.autoApprovalSettings.focus');
      })
    );
    
    // Register command to open LLM settings
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.openLLMSettings', async () => {
        vscode.commands.executeCommand('workbench.view.extension.koder-sidebar');
        vscode.commands.executeCommand('koder.llmSettings.focus');
      })
    );
    
    // Register command to test LLM connection
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.testLLMConnection', async () => {
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Testing LLM connection...",
          cancellable: false
        }, async (progress) => {
          const result = await llmService.testConnection();
          vscode.window.showInformationMessage(result);
        });
      })
    );
    
    // Register vector service commands
    
    // Embed current document
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.embedCurrentDocument', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) {
          vscode.window.showErrorMessage('No active document to embed');
          return;
        }
        
        try {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Embedding document...',
            cancellable: false
          }, async () => {
            await vectorService.embedDocument(document);
            vscode.window.showInformationMessage('Document embedded successfully');
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error embedding document: ${error}`);
        }
      })
    );
    
    // Embed workspace
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.embedWorkspace', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          vscode.window.showErrorMessage('No workspace folder is open');
          return;
        }
        
        try {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Embedding workspace...',
            cancellable: true
          }, async (progress, token) => {
            await vectorService.embedWorkspace(workspaceFolders[0].uri.fsPath, progress, token);
            vscode.window.showInformationMessage('Workspace embedded successfully');
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error embedding workspace: ${error}`);
        }
      })
    );
    
    // Search for similar code
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.searchSimilarCode', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document) {
          vscode.window.showErrorMessage('No active document to search');
          return;
        }
        
        const selection = vscode.window.activeTextEditor?.selection;
        if (!selection || selection.isEmpty) {
          vscode.window.showErrorMessage('Please select some code to search for similar code');
          return;
        }
        
        const selectedText = document.getText(selection);
        
        try {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Searching for similar code...',
            cancellable: false
          }, async () => {
            const results = await vectorService.searchSimilarCode(selectedText);
            
            if (results.length === 0) {
              vscode.window.showInformationMessage('No similar code found');
              return;
            }
            
            // Show results in quick pick
            const items = results.map(result => ({
              label: `${path.basename(result.metadata.path)} (${result.similarity.toFixed(2)})`,
              description: `Line ${result.metadata.startLine}-${result.metadata.endLine}`,
              detail: result.metadata.text.substring(0, 100) + '...',
              result
            }));
            
            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: 'Select a result to open',
              matchOnDescription: true,
              matchOnDetail: true
            });
            
            if (selected) {
              // Open the file at the correct position
              const doc = await vscode.workspace.openTextDocument(selected.result.metadata.path);
              const editor = await vscode.window.showTextDocument(doc);
              
              // Create selection at the matching code
              const startPos = new vscode.Position(selected.result.metadata.startLine, 0);
              const endPos = new vscode.Position(selected.result.metadata.endLine, 0);
              editor.selection = new vscode.Selection(startPos, endPos);
              
              // Scroll to the selection
              editor.revealRange(
                new vscode.Range(startPos, endPos),
                vscode.TextEditorRevealType.InCenter
              );
            }
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error searching for similar code: ${error}`);
        }
      })
    );

    // Auto-start if configured
    const config = vscode.workspace.getConfiguration('koder');
    if (config.get('enableAutocomplete')) {
      vscodeIntegration.start();
    }

  } catch (error) {
    console.error('Failed to activate KODER:', error);
    vscode.window.showErrorMessage(`KODER activation failed: ${error}`);
  }
}

export function deactivate() {
  console.log('KODER is now deactivated');
}
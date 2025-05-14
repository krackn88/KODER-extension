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
  
  try {
    // Initialize LLM service
    const llmService = new LLMService(context);
    
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
        vscode.commands.executeCommand('workbench.view.extension.koder-auto-approval-settings');
      })
    );
    
    // Register command to open LLM settings
    context.subscriptions.push(
      vscode.commands.registerCommand('koder.openLLMSettings', async () => {
        vscode.commands.executeCommand('workbench.view.extension.koder-llm-settings');
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
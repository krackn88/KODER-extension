import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryManager } from './memory';
import { AzureClient } from '../services/azure';
import { TerminalManager } from '../integrations/terminal/terminal-manager';
import { 
  AutoApprovalSettings, 
  DEFAULT_AUTO_APPROVAL_SETTINGS, 
  ActionUsageTracker,
  isCommandSafe,
  isFileExtensionSafe
} from './auto-approval';

export interface TaskMetadata {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
  complete: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export class Task {
  public id: string;
  public title: string;
  public timestamp: number;
  public messages: Message[];
  public api: AzureClient;
  public isStreaming: boolean;
  public isComplete: boolean;
  public terminalManager: TerminalManager;
  private terminalOutputs: Map<string, string> = new Map();
  
  // Auto-approval settings
  public autoApprovalSettings: AutoApprovalSettings;
  private usageTracker: ActionUsageTracker;
  
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly memoryManager: MemoryManager,
    private readonly outputChannel: vscode.OutputChannel,
    initialPrompt?: string,
    autoApprovalSettings?: AutoApprovalSettings
  ) {
    // Generate a unique ID for this task
    this.id = crypto.randomUUID();
    this.title = initialPrompt ? this.generateTitle(initialPrompt) : 'New Task';
    this.timestamp = Date.now();
    this.messages = [];
    this.isStreaming = false;
    this.isComplete = false;
    
    // Set auto-approval settings
    this.autoApprovalSettings = autoApprovalSettings || 
      this.loadAutoApprovalSettings() || 
      DEFAULT_AUTO_APPROVAL_SETTINGS;
      
    // Initialize usage tracker
    this.usageTracker = new ActionUsageTracker();
    
    // Initialize Azure client
    this.api = new AzureClient();
    
    // Initialize terminal manager
    this.terminalManager = new TerminalManager(
      context,
      outputChannel,
      (terminalId: string, output: string) => {
        // Store terminal output for context
        const currentOutput = this.terminalOutputs.get(terminalId) || '';
        this.terminalOutputs.set(terminalId, currentOutput + output);
      }
    );
    
    // Add initial prompt if provided
    if (initialPrompt) {
      this.addMessage('user', initialPrompt);
    }
  }
  
  /**
   * Load auto-approval settings from global state
   */
  private loadAutoApprovalSettings(): AutoApprovalSettings | undefined {
    const settings = this.context.globalState.get<AutoApprovalSettings>('autoApprovalSettings');
    return settings;
  }
  
  /**
   * Save auto-approval settings to global state
   */
  private async saveAutoApprovalSettings(): Promise<void> {
    await this.context.globalState.update('autoApprovalSettings', this.autoApprovalSettings);
  }
  
  /**
   * Generates a title from the initial prompt
   */
  private generateTitle(prompt: string): string {
    // Take the first 30 chars of the first line
    const firstLine = prompt.split('\n')[0].trim();
    if (firstLine.length <= 30) {
      return firstLine;
    }
    return firstLine.substring(0, 27) + '...';
  }
  
  /**
   * Adds a message to the task
   */
  public addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    const message: Message = {
      role,
      content,
      timestamp: Date.now()
    };
    
    this.messages.push(message);
    this.saveTask();
  }
  
  /**
   * Saves the current task state
   */
  private async saveTask(): Promise<void> {
    const metadata: TaskMetadata = {
      id: this.id,
      title: this.title,
      timestamp: this.timestamp,
      messages: this.messages,
      complete: this.isComplete
    };
    
    // Save to memory manager
    await this.memoryManager.storeTaskMetadata(metadata);
  }
  
  /**
   * Gets the terminal outputs for context
   */
  public getTerminalOutputsForContext(): string {
    let result = '';
    this.terminalOutputs.forEach((output, terminalId) => {
      if (output.trim().length > 0) {
        result += `\n---Terminal: ${terminalId}---\n${output}\n`;
      }
    });
    return result;
  }
  
  /**
   * Executes a terminal command
   */
  public async executeCommand(
    command: string,
    terminalName: string = 'KODER',
    forceApproval: boolean = false
  ): Promise<string> {
    // Check if we've hit the terminal command limit
    if (!this.usageTracker.canExecuteTerminalCommand(this.autoApprovalSettings)) {
      return `Error: Maximum number of terminal commands (${this.autoApprovalSettings.maximumTerminalCommands}) reached for this session.`;
    }
    
    // Check if session duration limit has been reached
    if (!this.usageTracker.isSessionWithinTimeLimit(this.autoApprovalSettings)) {
      return `Error: Maximum session duration (${this.autoApprovalSettings.maximumSessionDuration} minutes) reached.`;
    }
    
    // Determine if the command needs approval
    const isCommandInSafeList = isCommandSafe(command, this.autoApprovalSettings.safeTerminalCommands);
    const needsApproval = !forceApproval && 
                          !(this.autoApprovalSettings.autoApproveTerminalCommands && isCommandInSafeList);
    
    // Execute the command
    const result = await this.terminalManager.executeCommand(
      terminalName,
      command,
      needsApproval
    );
    
    // Record the usage
    this.usageTracker.recordTerminalCommand();
    
    // Record the result in messages
    this.addMessage(
      'system',
      `Executed command "${command}" in terminal "${terminalName}":\n\n${result}`
    );
    
    return result;
  }
  
  /**
   * Gets a file from the workspace
   */
  public async getFile(filePath: string): Promise<string | null> {
    // Use the workspace folder as the base directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }
    
    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    
    try {
      // Read the file
      const document = await vscode.workspace.openTextDocument(fullPath);
      return document.getText();
    } catch (error) {
      this.outputChannel.appendLine(`Error reading file ${filePath}: ${error}`);
      return null;
    }
  }
  
  /**
   * Edits a file in the workspace
   */
  public async editFile(
    filePath: string,
    newContent: string,
    forceApproval: boolean = false
  ): Promise<boolean> {
    // Check if we've hit the file operation limit
    if (!this.usageTracker.canPerformFileOperation(this.autoApprovalSettings)) {
      vscode.window.showErrorMessage(
        `Maximum number of file operations (${this.autoApprovalSettings.maximumFileOperations}) reached for this session.`
      );
      return false;
    }
    
    // Check if session duration limit has been reached
    if (!this.usageTracker.isSessionWithinTimeLimit(this.autoApprovalSettings)) {
      vscode.window.showErrorMessage(
        `Maximum session duration (${this.autoApprovalSettings.maximumSessionDuration} minutes) reached.`
      );
      return false;
    }
    
    // Use the workspace folder as the base directory
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }
    
    const fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
    
    try {
      // Check if file already exists
      let document: vscode.TextDocument;
      let isNewFile = false;
      
      try {
        document = await vscode.workspace.openTextDocument(fullPath);
      } catch {
        // File doesn't exist, this will be a creation
        isNewFile = true;
        
        // Determine if the file creation needs approval
        const isExtensionSafe = isFileExtensionSafe(filePath, this.autoApprovalSettings.safeFileExtensions);
        const needsApproval = !forceApproval && 
                              !(this.autoApprovalSettings.autoApproveFileCreation && isExtensionSafe);
        
        if (needsApproval) {
          const action = await vscode.window.showInformationMessage(
            `KODER wants to create a new file: ${filePath}`,
            { modal: true },
            'Create',
            'Cancel'
          );
          
          if (action !== 'Create') {
            return false;
          }
        }
        
        // Create a new file
        const fileUri = vscode.Uri.file(fullPath);
        const newFileContent = Buffer.from(newContent, 'utf8');
        await vscode.workspace.fs.writeFile(fileUri, newFileContent);
        document = await vscode.workspace.openTextDocument(fileUri);
        
        // Add message about file creation
        this.addMessage(
          'system',
          `Created file ${filePath}`
        );
        
        // Record the file operation
        this.usageTracker.recordFileOperation();
        
        return true;
      }
      
      // File exists, so this is an edit
      const oldContent = document.getText();
      
      if (oldContent === newContent) {
        // No changes needed
        return true;
      }
      
      // Determine if the file edit needs approval
      const isExtensionSafe = isFileExtensionSafe(filePath, this.autoApprovalSettings.safeFileExtensions);
      const needsApproval = !forceApproval && 
                           !(this.autoApprovalSettings.autoApproveFileEdits && isExtensionSafe);
      
      if (needsApproval) {
        // Create a diff and ask for approval
        const diffUri = this.createDiffUri(filePath, oldContent, newContent);
        
        const action = await this.showDiffAndConfirm(
          diffUri,
          `Changes to ${filePath}`,
          'Apply Changes',
          'Cancel'
        );
        
        if (action !== 'Apply Changes') {
          return false;
        }
      }
      
      // Apply changes
      const edit = new vscode.WorkspaceEdit();
      const fileUri = vscode.Uri.file(fullPath);
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      
      edit.replace(fileUri, fullRange, newContent);
      
      const success = await vscode.workspace.applyEdit(edit);
      
      if (success) {
        // Save the file
        await document.save();
        
        // Add message about file edit
        this.addMessage(
          'system',
          `Edited file ${filePath}`
        );
        
        // Record the file operation
        this.usageTracker.recordFileOperation();
      }
      
      return success;
    } catch (error) {
      this.outputChannel.appendLine(`Error editing file ${filePath}: ${error}`);
      return false;
    }
  }
  
  /**
   * Creates a URI for a diff view
   */
  private createDiffUri(
    filePath: string,
    oldContent: string,
    newContent: string
  ): vscode.Uri {
    // Encode the old content
    const encodedOldContent = Buffer.from(oldContent).toString('base64');
    
    // Create a URI for the diff view
    return vscode.Uri.parse(
      `koder-diff:${filePath}?${encodedOldContent}`,
      true
    );
  }
  
  /**
   * Shows a diff view and asks for confirmation
   */
  private async showDiffAndConfirm(
    diffUri: vscode.Uri,
    title: string,
    acceptButtonText: string,
    cancelButtonText: string
  ): Promise<string | undefined> {
    // Show the diff
    await vscode.commands.executeCommand('vscode.diff',
      diffUri,
      vscode.Uri.file(diffUri.path),
      title
    );
    
    // Ask for confirmation
    return vscode.window.showInformationMessage(
      'Do you want to apply these changes?',
      { modal: true },
      acceptButtonText,
      cancelButtonText
    );
  }
  
  /**
   * Record an API call
   */
  public recordApiCall(tokensUsed: number): void {
    this.usageTracker.recordApiCall(tokensUsed);
  }
  
  /**
   * Get current usage statistics
   */
  public getUsageStats(): any {
    return this.usageTracker.getUsageStats();
  }
  
  /**
   * Completes the task
   */
  public complete(): void {
    this.isComplete = true;
    this.saveTask();
  }
  
  /**
   * Cleans up resources
   */
  public dispose(): void {
    this.terminalManager.dispose();
  }
}
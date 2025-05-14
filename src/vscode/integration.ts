import * as vscode from 'vscode';
import { MemoryManager } from '../core/memory';
import { CodebaseIndexer } from '../core/indexer';
import { Task } from '../core/task';

export class VSCodeIntegration {
  private context: vscode.ExtensionContext;
  private memoryManager: MemoryManager;
  private indexer: CodebaseIndexer;
  private outputChannel: vscode.OutputChannel;
  private statusBarItem: vscode.StatusBarItem;
  private isActive: boolean = false;
  private currentTask?: Task;

  constructor(
    context: vscode.ExtensionContext,
    memoryManager: MemoryManager,
    indexer: CodebaseIndexer
  ) {
    this.context = context;
    this.memoryManager = memoryManager;
    this.indexer = indexer;
    
    // Create output channel for logs
    this.outputChannel = vscode.window.createOutputChannel('KODER');
    
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(brain) KODER';
    this.statusBarItem.tooltip = 'KODER Pair Programming Assistant';
    this.statusBarItem.command = 'koder.ask';
    this.context.subscriptions.push(this.statusBarItem);
    
    // Setup file watchers and event handlers
    this.setupEventHandlers();
  }

  public start(): void {
    if (this.isActive) {
      return;
    }
    
    this.isActive = true;
    this.statusBarItem.show();
    this.log('KODER pair programming assistant started');
    
    // Check if workspace is already indexed
    this.checkWorkspaceIndex();
  }

  public stop(): void {
    this.isActive = false;
    this.statusBarItem.hide();
    this.log('KODER pair programming assistant stopped');
    
    // Clean up current task
    if (this.currentTask) {
      this.currentTask.dispose();
      this.currentTask = undefined;
    }
  }

  private setupEventHandlers(): void {
    // Listen for document changes
    vscode.workspace.onDidChangeTextDocument(event => {
      if (this.isActive) {
        // Handle document changes
        this.onDocumentChanged(event);
      }
    }, null, this.context.subscriptions);
    
    // Listen for document saves
    vscode.workspace.onDidSaveTextDocument(document => {
      if (this.isActive) {
        // Handle document saves
        this.onDocumentSaved(document);
      }
    }, null, this.context.subscriptions);
    
    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (this.isActive && editor) {
        // Handle editor focus changes
        this.onEditorFocusChanged(editor);
      }
    }, null, this.context.subscriptions);
  }

  private async checkWorkspaceIndex(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return;
    }
    
    // Check if workspace needs indexing
    // In a real implementation, check metadata to see if already indexed
    const shouldIndex = true; // This would be determined by checking if index exists
    
    if (shouldIndex) {
      const indexNow = await vscode.window.showInformationMessage(
        'KODER needs to index your workspace for best results. Index now?',
        'Yes', 'Later'
      );
      
      if (indexNow === 'Yes') {
        vscode.commands.executeCommand('koder.indexWorkspace');
      }
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    // Handle document changes for real-time analysis
    // This would be implemented with debouncing to avoid excessive processing
  }

  private onDocumentSaved(document: vscode.TextDocument): void {
    // Update the index when a document is saved
    this.log(`Document saved: ${document.fileName}`);
  }

  private onEditorFocusChanged(editor: vscode.TextEditor): void {
    // Respond to editor focus changes
    this.log(`Editor focus changed: ${editor.document.fileName}`);
  }

  public async askQuestion(question: string): Promise<void> {
    this.log(`User question: ${question}`);
    
    // Get active document for context
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('No active editor to provide context');
      return;
    }
    
    // Show progress
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'KODER is thinking...',
      cancellable: false
    }, async (progress) => {
      try {
        // Create a task for this question
        this.currentTask = new Task(
          this.context,
          this.memoryManager,
          this.outputChannel,
          question
        );
        
        // Get current file content for context
        const filePath = activeEditor.document.fileName;
        const fileContent = activeEditor.document.getText();
        
        // Get selected code if any
        const selection = activeEditor.selection;
        const selectedCode = activeEditor.document.getText(selection);
        
        // Add relevant context to the task
        if (selectedCode) {
          this.currentTask.addMessage('system', 
            `User has selected the following code in file ${filePath}:\n\n${selectedCode}`);
        }
        
        // Prepare context
        const contextFiles = [fileContent];
        
        // Search for relevant files based on question
        const searchResults = await this.memoryManager.search(question);
        
        // Add relevant files to context
        for (const result of searchResults) {
          const content = await this.memoryManager.getFile(result.path);
          if (content) {
            contextFiles.push(content);
            this.currentTask.addMessage('system', 
              `Relevant file ${result.path}:\n\n${content}`);
          }
        }
        
        // Get terminal outputs for context
        const terminalContext = this.currentTask.getTerminalOutputsForContext();
        if (terminalContext) {
          this.currentTask.addMessage('system', 
            `Terminal output context:\n${terminalContext}`);
        }
        
        // Get AI response using streaming for better UX
        const answerPartialChunks: string[] = [];
        const stream = this.currentTask.api.createStreamedResponse(
          question,
          this.currentTask.messages
            .filter(m => m.role !== 'assistant')
            .map(m => m.content)
        );
        
        // Show the stream response in the editor
        const responseDoc = await vscode.workspace.openTextDocument({
          content: '',
          language: 'markdown'
        });
        
        const responseEditor = await vscode.window.showTextDocument(responseDoc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false
        });
        
        // Process the stream
        for await (const chunk of stream) {
          answerPartialChunks.push(chunk);
          const fullText = answerPartialChunks.join('');
          
          // Update the editor with the current text
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            responseDoc.uri,
            new vscode.Range(0, 0, responseDoc.lineCount, 0),
            fullText
          );
          await vscode.workspace.applyEdit(edit);
        }
        
        // Join all chunks for the final answer
        const answer = answerPartialChunks.join('');
        
        // Add the AI response to the task
        this.currentTask.addMessage('assistant', answer);
        
        // Complete the task
        this.currentTask.complete();
      } catch (error) {
        console.error('Error processing question:', error);
        vscode.window.showErrorMessage(`Failed to process question: ${error}`);
      }
    });
  }
  
  /**
   * Add terminal output to the current chat
   */
  public async addTerminalOutputToChat(output: string, terminalName: string): Promise<void> {
    // Create a task if one doesn't exist
    if (!this.currentTask) {
      this.currentTask = new Task(
        this.context,
        this.memoryManager,
        this.outputChannel,
        'Terminal Integration'
      );
    }
    
    // Format the terminal output
    const formattedOutput = `Terminal output from "${terminalName}":\n\n\`\`\`\n${output}\n\`\`\``;
    
    // Show input box to ask the user what they want to know
    const question = await vscode.window.showInputBox({
      prompt: `What would you like to know about this terminal output from "${terminalName}"?`,
      placeHolder: 'e.g., What does this error mean?'
    });
    
    if (question) {
      // Add the terminal output as context
      this.currentTask.addMessage('system', formattedOutput);
      
      // Add the user question
      this.currentTask.addMessage('user', question);
      
      // Get AI response using streaming for better UX
      const answerPartialChunks: string[] = [];
      const stream = this.currentTask.api.createStreamedResponse(
        question,
        this.currentTask.messages
          .filter(m => m.role !== 'assistant')
          .map(m => m.content)
      );
      
      // Show progress
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'KODER is analyzing terminal output...',
        cancellable: false
      }, async (progress) => {
        try {
          // Show the stream response in the editor
          const responseDoc = await vscode.workspace.openTextDocument({
            content: '',
            language: 'markdown'
          });
          
          const responseEditor = await vscode.window.showTextDocument(responseDoc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false
          });
          
          // Process the stream
          for await (const chunk of stream) {
            answerPartialChunks.push(chunk);
            const fullText = answerPartialChunks.join('');
            
            // Update the editor with the current text
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              responseDoc.uri,
              new vscode.Range(0, 0, responseDoc.lineCount, 0),
              fullText
            );
            await vscode.workspace.applyEdit(edit);
          }
          
          // Join all chunks for the final answer
          const answer = answerPartialChunks.join('');
          
          // Add the AI response to the task
          this.currentTask.addMessage('assistant', answer);
        } catch (error) {
          console.error('Error processing terminal output:', error);
          vscode.window.showErrorMessage(`Failed to process terminal output: ${error}`);
        }
      });
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
}
import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Manages a specific VSCode terminal session
 */
export class TerminalSession {
  private outputBuffer: string = '';
  private commandQueue: {
    command: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    outputSnapshot: string;
    marker: string;
  }[] = [];
  private isProcessingCommand: boolean = false;
  private disposables: vscode.Disposable[] = [];
  
  constructor(
    public readonly terminal: vscode.Terminal,
    private readonly onOutput: (output: string) => void,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    // Set up output monitoring if VS Code API supports it
    if ('onDidWriteTerminalData' in vscode.window) {
      this.setupOutputMonitoring();
    } else {
      this.outputChannel.appendLine('Terminal output monitoring not supported in this VS Code version');
    }
  }
  
  /**
   * Sets up terminal output monitoring
   */
  private setupOutputMonitoring(): void {
    // @ts-ignore - This is available in newer VS Code versions
    this.disposables.push(vscode.window.onDidWriteTerminalData(event => {
      if (event.terminal.name === this.terminal.name) {
        const text = event.data;
        this.outputBuffer += text;
        this.onOutput(text);
        
        // Check if we're processing a command and the output contains our marker
        if (this.isProcessingCommand && this.commandQueue.length > 0) {
          const currentCommand = this.commandQueue[0];
          
          if (this.outputBuffer.includes(currentCommand.marker)) {
            // Command has completed, extract output
            const commandOutput = this.extractCommandOutput(
              currentCommand.outputSnapshot,
              this.outputBuffer,
              currentCommand.marker
            );
            
            // Resolve the promise with the command output
            currentCommand.resolve(commandOutput);
            this.commandQueue.shift();
            
            if (this.commandQueue.length === 0) {
              this.isProcessingCommand = false;
            } else {
              // Process the next command in the queue
              this.executeNextCommand();
            }
          }
        }
      }
    }));
  }
  
  /**
   * Executes a command in the terminal
   * @param command The command to execute
   * @returns Promise<string> The command output
   */
  public async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create a unique marker to identify when command completes
      const marker = this.generateMarker();
      
      // Add to queue
      this.commandQueue.push({
        command,
        resolve,
        reject,
        outputSnapshot: this.outputBuffer,
        marker
      });
      
      if (!this.isProcessingCommand) {
        this.isProcessingCommand = true;
        this.executeNextCommand();
      }
    });
  }
  
  /**
   * Executes the next command in the queue
   */
  private executeNextCommand(): void {
    if (this.commandQueue.length === 0) {
      this.isProcessingCommand = false;
      return;
    }
    
    const { command, marker } = this.commandQueue[0];
    
    try {
      // Send command to terminal
      this.terminal.sendText(command);
      
      // Send the marker command - when this appears in output, we know the command has completed
      // We use a semicolon to ensure the commands are separate in most shells
      this.terminal.sendText(`echo "${marker}"`);
    } catch (error) {
      this.commandQueue[0].reject(error);
      this.commandQueue.shift();
      
      if (this.commandQueue.length === 0) {
        this.isProcessingCommand = false;
      } else {
        this.executeNextCommand();
      }
    }
  }
  
  /**
   * Extracts the output of a command from the terminal buffer
   * @param beforeOutput The output buffer before the command was executed
   * @param afterOutput The output buffer after the command completed
   * @param marker The marker used to identify command completion
   * @returns The command output
   */
  private extractCommandOutput(beforeOutput: string, afterOutput: string, marker: string): string {
    // Find the difference between before and after
    const beforeLength = beforeOutput.length;
    const newOutput = afterOutput.substring(beforeLength);
    
    // Extract the output up to the marker
    const markerIndex = newOutput.indexOf(marker);
    if (markerIndex >= 0) {
      return newOutput.substring(0, markerIndex).trim();
    }
    
    return newOutput.trim();
  }
  
  /**
   * Generates a unique marker for command completion
   */
  private generateMarker(): string {
    return `KODER_COMMAND_COMPLETE_${crypto.randomBytes(8).toString('hex')}`;
  }
  
  /**
   * Returns the current terminal output history
   */
  public getOutputHistory(): string {
    return this.outputBuffer;
  }
  
  /**
   * Cleans up resources
   */
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
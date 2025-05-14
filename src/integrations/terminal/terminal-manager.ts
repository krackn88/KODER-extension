import * as vscode from 'vscode';
import * as os from 'os';
import { TerminalSession } from './terminal-session';

/**
 * Manages terminal integration for the KODER extension
 */
export class TerminalManager {
  private terminals: Map<string, TerminalSession> = new Map();
  private outputChannel: vscode.OutputChannel;
  
  constructor(
    private readonly context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    private readonly onTerminalOutput: (terminalId: string, output: string) => void
  ) {
    this.outputChannel = outputChannel;
    
    // Listen for terminal creation
    context.subscriptions.push(
      vscode.window.onDidOpenTerminal(terminal => {
        this.setupTerminal(terminal);
      })
    );
    
    // Listen for terminal disposal
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal(terminal => {
        this.terminals.delete(terminal.name);
      })
    );
    
    // Set up existing terminals
    vscode.window.terminals.forEach(terminal => {
      this.setupTerminal(terminal);
    });
  }
  
  /**
   * Sets up terminal for monitoring
   */
  private setupTerminal(terminal: vscode.Terminal): void {
    const terminalSession = new TerminalSession(
      terminal,
      (output: string) => {
        this.onTerminalOutput(terminal.name, output);
      },
      this.outputChannel
    );
    
    this.terminals.set(terminal.name, terminalSession);
    this.outputChannel.appendLine(`Terminal configured: ${terminal.name}`);
  }
  
  /**
   * Executes a command in the specified terminal
   * @param terminalName The name of the terminal to use
   * @param command The command to execute
   * @param waitForUserApproval Whether to wait for user approval before executing
   * @returns Promise<string> The command result
   */
  public async executeCommand(
    terminalName: string = 'KODER',
    command: string,
    waitForUserApproval: boolean = true
  ): Promise<string> {
    // Find or create the requested terminal
    let terminal: vscode.Terminal;
    let terminalSession = this.terminals.get(terminalName);
    
    if (!terminalSession) {
      // Create a new terminal if it doesn't exist
      terminal = vscode.window.createTerminal({
        name: terminalName,
        shellPath: this.getDefaultShell()
      });
      
      this.setupTerminal(terminal);
      terminalSession = this.terminals.get(terminalName)!;
      
      // Show the terminal
      terminal.show();
    } else {
      terminal = terminalSession.terminal;
      terminal.show();
    }
    
    if (waitForUserApproval) {
      // Ask for user approval
      const action = await vscode.window.showInformationMessage(
        `KODER wants to run the following command: ${command}`,
        { modal: true },
        'Run',
        'Cancel'
      );
      
      if (action !== 'Run') {
        return 'Command execution canceled by user';
      }
    }
    
    // Execute the command and get result
    const result = await terminalSession.executeCommand(command);
    return result;
  }
  
  /**
   * Returns the current terminal output
   * @param terminalName The name of the terminal
   */
  public getTerminalHistory(terminalName: string): string | undefined {
    const terminalSession = this.terminals.get(terminalName);
    if (terminalSession) {
      return terminalSession.getOutputHistory();
    }
    return undefined;
  }
  
  /**
   * Gets the default shell based on the OS
   */
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return 'powershell.exe';
    } else if (os.platform() === 'darwin') {
      return '/bin/zsh';
    } else {
      return '/bin/bash';
    }
  }
  
  /**
   * Dispose all terminal sessions
   */
  public dispose(): void {
    this.terminals.forEach(session => session.dispose());
    this.terminals.clear();
  }
}
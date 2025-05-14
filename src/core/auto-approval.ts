/**
 * Settings for auto-approval of actions
 */
export interface AutoApprovalSettings {
  // Version for tracking changes
  version: number;
  
  // Terminal commands
  autoApproveTerminalCommands: boolean;
  maximumTerminalCommands: number;
  safeTerminalCommands: string[];
  
  // File operations
  autoApproveFileCreation: boolean;
  autoApproveFileEdits: boolean;
  maximumFileOperations: number;
  safeFileExtensions: string[];
  
  // Browser operations (for future implementation)
  autoApproveBrowserOperations: boolean;
  maximumBrowserOperations: number;
  safeBrowserDomains: string[];
  
  // API limits
  maximumApiCalls: number;
  apiCallBudget: number; // in tokens
  
  // Per-session limits
  maximumSessionDuration: number; // in minutes, 0 for unlimited
}

/**
 * Default auto-approval settings
 */
export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
  version: 1,
  
  // Terminal commands - default to requiring approval
  autoApproveTerminalCommands: false,
  maximumTerminalCommands: 5,
  safeTerminalCommands: [
    'ls', 'dir', 'pwd', 'cd', 'echo', 'cat',
    'git status', 'git log', 'git branch',
    'npm list', 'npm outdated',
    'python --version', 'pip list'
  ],
  
  // File operations - default to requiring approval
  autoApproveFileCreation: false,
  autoApproveFileEdits: false,
  maximumFileOperations: 10,
  safeFileExtensions: [
    '.md', '.txt', '.json', '.yaml', '.yml',
    '.js', '.ts', '.jsx', '.tsx', '.py', '.html', '.css'
  ],
  
  // Browser operations - for future implementation
  autoApproveBrowserOperations: false,
  maximumBrowserOperations: 5,
  safeBrowserDomains: [
    'localhost', '127.0.0.1'
  ],
  
  // API limits
  maximumApiCalls: 20,
  apiCallBudget: 100000, // 100k tokens
  
  // Session limits
  maximumSessionDuration: 60 // 60 minutes
};

/**
 * Check if a terminal command is in the safe list
 */
export function isCommandSafe(command: string, safeCommands: string[]): boolean {
  // Normalize command by trimming and converting to lowercase
  const normalizedCommand = command.trim().toLowerCase();
  
  // Check if command exactly matches or starts with any safe command
  return safeCommands.some(safeCmd => {
    const normalizedSafeCmd = safeCmd.trim().toLowerCase();
    return normalizedCommand === normalizedSafeCmd || 
           normalizedCommand.startsWith(normalizedSafeCmd + ' ');
  });
}

/**
 * Check if a file extension is in the safe list
 */
export function isFileExtensionSafe(filePath: string, safeExtensions: string[]): boolean {
  // Get the file extension
  const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  
  // Check if extension is in the safe list
  return safeExtensions.includes(extension);
}

/**
 * Usage tracker for monitoring action limits
 */
export class ActionUsageTracker {
  private terminalCommandCount: number = 0;
  private fileOperationCount: number = 0;
  private browserOperationCount: number = 0;
  private apiCallCount: number = 0;
  private apiTokensUsed: number = 0;
  private startTime: number = Date.now();
  
  /**
   * Check if terminal command usage is under limit
   */
  public canExecuteTerminalCommand(settings: AutoApprovalSettings): boolean {
    return this.terminalCommandCount < settings.maximumTerminalCommands;
  }
  
  /**
   * Record a terminal command execution
   */
  public recordTerminalCommand(): void {
    this.terminalCommandCount++;
  }
  
  /**
   * Check if file operation usage is under limit
   */
  public canPerformFileOperation(settings: AutoApprovalSettings): boolean {
    return this.fileOperationCount < settings.maximumFileOperations;
  }
  
  /**
   * Record a file operation
   */
  public recordFileOperation(): void {
    this.fileOperationCount++;
  }
  
  /**
   * Check if browser operation usage is under limit
   */
  public canPerformBrowserOperation(settings: AutoApprovalSettings): boolean {
    return this.browserOperationCount < settings.maximumBrowserOperations;
  }
  
  /**
   * Record a browser operation
   */
  public recordBrowserOperation(): void {
    this.browserOperationCount++;
  }
  
  /**
   * Check if API usage is under limit
   */
  public canMakeApiCall(settings: AutoApprovalSettings): boolean {
    return this.apiCallCount < settings.maximumApiCalls;
  }
  
  /**
   * Check if token budget is under limit
   */
  public canUseTokens(tokensToUse: number, settings: AutoApprovalSettings): boolean {
    return (this.apiTokensUsed + tokensToUse) <= settings.apiCallBudget;
  }
  
  /**
   * Record an API call with token usage
   */
  public recordApiCall(tokensUsed: number): void {
    this.apiCallCount++;
    this.apiTokensUsed += tokensUsed;
  }
  
  /**
   * Check if session is still within time limit
   */
  public isSessionWithinTimeLimit(settings: AutoApprovalSettings): boolean {
    // If maximum session duration is 0, it means unlimited
    if (settings.maximumSessionDuration === 0) {
      return true;
    }
    
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - this.startTime) / (1000 * 60);
    return elapsedMinutes < settings.maximumSessionDuration;
  }
  
  /**
   * Get usage statistics
   */
  public getUsageStats(): {
    terminalCommands: number;
    fileOperations: number;
    browserOperations: number;
    apiCalls: number;
    tokensUsed: number;
    sessionDurationMinutes: number;
  } {
    const currentTime = Date.now();
    const sessionDurationMinutes = (currentTime - this.startTime) / (1000 * 60);
    
    return {
      terminalCommands: this.terminalCommandCount,
      fileOperations: this.fileOperationCount,
      browserOperations: this.browserOperationCount,
      apiCalls: this.apiCallCount,
      tokensUsed: this.apiTokensUsed,
      sessionDurationMinutes
    };
  }
  
  /**
   * Reset usage counter
   */
  public reset(): void {
    this.terminalCommandCount = 0;
    this.fileOperationCount = 0;
    this.browserOperationCount = 0;
    this.apiCallCount = 0;
    this.apiTokensUsed = 0;
    this.startTime = Date.now();
  }
}
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryManager } from './memory';

export class CodebaseIndexer {
  private memoryManager: MemoryManager;
  private fileTypes: string[];
  private excludeDirs: string[];

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
    this.fileTypes = [
      '.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', 
      '.go', '.rs', '.rb', '.php', '.html', '.css', '.scss', '.json', '.md'
    ];
    
    this.excludeDirs = [
      'node_modules', 'dist', 'build', 'out', '.git', 
      '__pycache__', 'venv', '.vscode', '.idea'
    ];
  }

  public async indexWorkspace(workspacePath: string): Promise<void> {
    console.log(`Indexing workspace: ${workspacePath}`);
    
    try {
      // Start the indexing process recursively
      await this.indexDirectory(workspacePath);
      console.log('Workspace indexing completed');
      
      // Save metadata about the indexed workspace
      await this.memoryManager.saveWorkspaceMetadata({
        path: workspacePath,
        lastIndexed: new Date().toISOString(),
        fileCount: await this.memoryManager.getFileCount()
      });
    } catch (error) {
      console.error('Error indexing workspace:', error);
      throw error;
    }
  }

  private async indexDirectory(dirPath: string): Promise<void> {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip excluded directories
        if (!this.excludeDirs.includes(entry.name)) {
          await this.indexDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        // Check if file type is supported
        const ext = path.extname(entry.name).toLowerCase();
        if (this.fileTypes.includes(ext)) {
          await this.indexFile(fullPath);
        }
      }
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    try {
      // Read file content
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Create a hash of the file content for future change detection
      const hash = crypto.createHash('md5').update(content).digest('hex');
      
      // Store file in memory system
      await this.memoryManager.storeFile({
        path: filePath,
        content,
        hash,
        lastModified: fs.statSync(filePath).mtime.toISOString(),
        fileType: path.extname(filePath).toLowerCase().substring(1)
      });
      
      console.log(`Indexed file: ${filePath}`);
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
      // Continue with other files even if one fails
    }
  }

  public async checkForChanges(workspacePath: string): Promise<string[]> {
    const changedFiles: string[] = [];
    // Implement change detection logic
    // This would compare current files with previously indexed versions
    return changedFiles;
  }
}
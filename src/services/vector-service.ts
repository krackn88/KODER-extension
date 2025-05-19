import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { VectorStore, VectorStoreFactory, VectorStoreConfig } from './vector/vector-store';
import { LLMService } from './llm-service';

/**
 * Configuration for the vector service
 */
export interface VectorServiceConfig {
  /** Type of vector store to use */
  vectorStoreType: 'memory' | 'sqlite' | 'qdrant';
  
  /** Storage path for vectors */
  storagePath?: string;
  
  /** Vector dimensions */
  dimensions: number;
  
  /** Default chunk size for text splitting (in characters) */
  defaultChunkSize: number;
  
  /** Default chunk overlap (in characters) */
  defaultChunkOverlap: number;
  
  /** Enable auto-embedding for workspace files */
  enableAutoEmbedding: boolean;
}

/**
 * Default configuration for the vector service
 */
export const DEFAULT_VECTOR_SERVICE_CONFIG: VectorServiceConfig = {
  vectorStoreType: 'sqlite',
  dimensions: 384,
  defaultChunkSize: 1024,
  defaultChunkOverlap: 200,
  enableAutoEmbedding: true
};

/**
 * Service for managing code embeddings and semantic search
 */
export class VectorService {
  private config: VectorServiceConfig;
  private vectorStore: VectorStore;
  private llmService: LLMService;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  
  /**
   * Create a new vector service
   * @param context VS Code extension context
   * @param llmService LLM service for generating embeddings
   * @param config Vector service configuration
   */
  constructor(
    context: vscode.ExtensionContext,
    llmService: LLMService,
    config: Partial<VectorServiceConfig> = {}
  ) {
    this.context = context;
    this.llmService = llmService;
    
    // Merge with default config
    this.config = {
      ...DEFAULT_VECTOR_SERVICE_CONFIG,
      ...config
    };
    
    // If no storage path is provided, use the extension storage path
    if (!this.config.storagePath) {
      this.config.storagePath = path.join(context.globalStorageUri.fsPath, 'vectors');
    }
    
    // Initialize vector store
    const vectorStoreConfig: VectorStoreConfig = {
      storagePath: this.config.storagePath,
      dimensions: this.config.dimensions
    };
    
    this.vectorStore = VectorStoreFactory.create(
      this.config.vectorStoreType,
      vectorStoreConfig
    );
    
    // Set up auto-embedding if enabled
    if (this.config.enableAutoEmbedding) {
      this.setupAutoEmbedding();
    }
    
    // Register commands
    this.registerCommands();
  }
  
  /**
   * Set up auto-embedding for workspace files
   */
  private setupAutoEmbedding() {
    // Listen for document saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        // Only embed code files (exclude configuration files, etc.)
        if (this.shouldEmbedDocument(document)) {
          try {
            await this.embedDocument(document);
          } catch (error) {
            console.error('Error auto-embedding document:', error);
          }
        }
      })
    );
  }
  
  /**
   * Determine if a document should be embedded
   * @param document Text document
   * @returns True if the document should be embedded
   */
  private shouldEmbedDocument(document: vscode.TextDocument): boolean {
    const ext = path.extname(document.fileName).toLowerCase();
    const fileName = path.basename(document.fileName).toLowerCase();
    
    // Skip non-code files
    const codeExts = [
      '.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', 
      '.go', '.rs', '.rb', '.php', '.html', '.css', '.scss', '.md'
    ];
    
    // Skip binary files, large files, and common non-code files
    const skipFiles = [
      'package-lock.json', 'yarn.lock', '.gitignore', '.gitattributes',
      '.editorconfig', '.prettierrc', '.eslintrc'
    ];
    
    const isCodeFile = codeExts.includes(ext);
    const isSkippedFile = skipFiles.includes(fileName);
    const isTooLarge = document.getText().length > 100000; // Skip files larger than 100KB
    
    return isCodeFile && !isSkippedFile && !isTooLarge;
  }
  
  /**
   * Register commands
   */
  private registerCommands() {
    this.disposables.push(
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
            await this.embedDocument(document);
            vscode.window.showInformationMessage('Document embedded successfully');
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error embedding document: ${error}`);
        }
      })
    );
    
    this.disposables.push(
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
            await this.embedWorkspace(workspaceFolders[0].uri.fsPath, progress, token);
            vscode.window.showInformationMessage('Workspace embedded successfully');
          });
        } catch (error) {
          vscode.window.showErrorMessage(`Error embedding workspace: ${error}`);
        }
      })
    );
    
    this.disposables.push(
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
            const results = await this.searchSimilarCode(selectedText);
            
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
  }
  
  /**
   * Embed a document into the vector store
   * @param document Text document to embed
   */
  public async embedDocument(document: vscode.TextDocument): Promise<void> {
    // Get the document text
    const text = document.getText();
    
    // Skip empty or very small documents
    if (text.length < 10) {
      return;
    }
    
    // Split the document into chunks
    const chunks = this.splitTextIntoChunks(
      text,
      this.config.defaultChunkSize,
      this.config.defaultChunkOverlap
    );
    
    // Skip if no chunks
    if (chunks.length === 0) {
      return;
    }
    
    // Get line ranges for each chunk
    const lineRanges = this.getLineRangesForChunks(document, chunks);
    
    // Delete existing vectors for this document
    const existingIds = await this.vectorStore.getAllIds();
    const documentPrefix = `doc:${document.fileName}:`;
    for (const id of existingIds) {
      if (id.startsWith(documentPrefix)) {
        await this.vectorStore.deleteVector(id);
      }
    }
    
    // Embed each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { startLine, endLine } = lineRanges[i];
      
      // Generate a unique ID for this chunk
      const chunkId = `doc:${document.fileName}:${startLine}-${endLine}`;
      
      // Embed the chunk
      const embedding = await this.getEmbedding(chunk);
      
      // Store the embedding
      await this.vectorStore.storeVector(chunkId, embedding, {
        path: document.fileName,
        text: chunk,
        startLine,
        endLine,
        language: document.languageId,
        lastUpdated: new Date().toISOString()
      });
    }
  }
  
  /**
   * Split text into overlapping chunks
   * @param text Text to split
   * @param chunkSize Size of each chunk
   * @param overlap Overlap between chunks
   * @returns Array of text chunks
   */
  private splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    
    if (text.length <= chunkSize) {
      chunks.push(text);
      return chunks;
    }
    
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.substring(start, end));
      start = end - overlap;
      
      // If the remaining text is smaller than the overlap, just end
      if (text.length - start < overlap) {
        break;
      }
    }
    
    return chunks;
  }
  
  /**
   * Get line ranges for each chunk
   * @param document Text document
   * @param chunks Text chunks
   * @returns Line ranges for each chunk
   */
  private getLineRangesForChunks(
    document: vscode.TextDocument,
    chunks: string[]
  ): Array<{ startLine: number, endLine: number }> {
    const ranges: Array<{ startLine: number, endLine: number }> = [];
    
    let currentPos = 0;
    for (const chunk of chunks) {
      const startPos = document.positionAt(currentPos);
      const endPos = document.positionAt(currentPos + chunk.length);
      
      ranges.push({
        startLine: startPos.line,
        endLine: endPos.line
      });
      
      // Update current position considering overlap
      const overlap = this.config.defaultChunkOverlap;
      currentPos += chunk.length - overlap;
      
      // Handle edge case at the end
      if (currentPos >= document.getText().length) {
        break;
      }
    }
    
    return ranges;
  }
  
  /**
   * Embed an entire workspace
   * @param workspacePath Path to the workspace
   * @param progress Progress reporter
   * @param token Cancellation token
   */
  public async embedWorkspace(
    workspacePath: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken
  ): Promise<void> {
    // Collect documents to embed
    const pattern = new vscode.RelativePattern(
      workspacePath,
      '**/*.{ts,js,jsx,tsx,py,java,c,cpp,cs,go,rs,rb,php,html,css,scss,md}'
    );
    
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
    
    if (progress) {
      progress.report({ message: `Found ${files.length} files to embed` });
    }
    
    // Process files in batches of 10
    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      if (token?.isCancellationRequested) {
        break;
      }
      
      const batch = files.slice(i, i + batchSize);
      
      if (progress) {
        progress.report({ 
          message: `Processing files ${i + 1}-${Math.min(i + batchSize, files.length)} of ${files.length}`,
          increment: (batchSize / files.length) * 100
        });
      }
      
      // Process files in parallel
      await Promise.all(batch.map(async (file) => {
        try {
          const document = await vscode.workspace.openTextDocument(file);
          await this.embedDocument(document);
        } catch (error) {
          console.error(`Error embedding file ${file.fsPath}:`, error);
        }
      }));
    }
  }
  
  /**
   * Get an embedding for text
   * @param text Text to embed
   * @returns Embedding vector
   */
  private async getEmbedding(text: string): Promise<number[]> {
    // Try to get the embedding from the LLM service
    const embedding = await this.llmService.getEmbedding(text);
    
    if (embedding) {
      return embedding;
    }
    
    // If the LLM service doesn't support embeddings, use a fallback
    // This is a simple hash-based pseudo-embedding for testing
    return this.getFallbackEmbedding(text);
  }
  
  /**
   * Get a fallback embedding based on hashing
   * @param text Text to embed
   * @returns Pseudo-embedding vector
   */
  private getFallbackEmbedding(text: string): number[] {
    // This is a very simplistic approach just for testing
    // It's not semantically meaningful, but allows the system to function
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    
    // Convert the hash to a vector of the desired dimensions
    const vector: number[] = [];
    for (let i = 0; i < this.config.dimensions; i++) {
      // Use pairs of hex characters as basis for the embedding values
      const hexPair = hash.substring((i * 2) % hash.length, ((i * 2) % hash.length) + 2);
      const value = parseInt(hexPair, 16) / 255 * 2 - 1; // Scale to [-1, 1]
      vector.push(value);
    }
    
    return vector;
  }
  
  /**
   * Search for similar code to the given text
   * @param text Text to search for
   * @param limit Maximum number of results to return
   * @param threshold Similarity threshold
   * @returns Array of similar code chunks
   */
  public async searchSimilarCode(
    text: string,
    limit: number = 5,
    threshold: number = 0.7
  ): Promise<Array<{
    id: string;
    similarity: number;
    metadata: any;
  }>> {
    // Get embedding for the query text
    const embedding = await this.getEmbedding(text);
    
    // Search the vector store
    const results = await this.vectorStore.search(embedding, limit, threshold);
    
    // Map results to a simpler format
    return results.map(result => ({
      id: result.id,
      similarity: result.similarity,
      metadata: result.metadata
    }));
  }
  
  /**
   * Get statistics about the vector store
   */
  public async getStats(): Promise<any> {
    // Convert the vector store to any to access implementation-specific methods
    const store = this.vectorStore as any;
    
    if (store.getStats) {
      return await store.getStats();
    }
    
    // Fallback for vector stores without stats method
    const count = await store.getCount?.() || 0;
    
    return {
      count,
      dimensions: this.config.dimensions,
      type: this.config.vectorStoreType
    };
  }
  
  /**
   * Clear all vectors from the store
   */
  public async clear(): Promise<void> {
    await this.vectorStore.clear();
  }
  
  /**
   * Dispose the vector service
   */
  public dispose(): void {
    // Dispose all registered disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    
    // Close the vector store if it has a close method
    const store = this.vectorStore as any;
    if (store.close) {
      store.close().catch(console.error);
    }
  }
}
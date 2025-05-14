import * as fs from 'fs';
import * as path from 'path';
import { AzureClient } from '../services/azure';
import { TaskMetadata } from './task';

interface FileInfo {
  path: string;
  content: string;
  hash: string;
  lastModified: string;
  fileType: string;
}

interface WorkspaceMetadata {
  path: string;
  lastIndexed: string;
  fileCount: number;
}

export class MemoryManager {
  private azureClient: AzureClient;
  private localCachePath: string;
  private tasksCachePath: string;
  private fileCount: number = 0;

  constructor(azureClient: AzureClient) {
    this.azureClient = azureClient;
    
    // Setup local cache directory
    this.localCachePath = process.env.KODER_MEMORY_PATH || path.join(process.cwd(), '.koder-cache');
    this.tasksCachePath = path.join(this.localCachePath, 'tasks');
    
    // Create cache directories if they don't exist
    this.ensureCacheDirectories();
  }

  private async ensureCacheDirectories(): Promise<void> {
    // Create main cache directory
    if (!fs.existsSync(this.localCachePath)) {
      fs.mkdirSync(this.localCachePath, { recursive: true });
    }
    
    // Create tasks directory
    if (!fs.existsSync(this.tasksCachePath)) {
      fs.mkdirSync(this.tasksCachePath, { recursive: true });
    }
  }

  public async storeFile(fileInfo: FileInfo): Promise<void> {
    try {
      // Store in local cache
      await this.storeFileLocally(fileInfo);
      
      // Store in Azure Blob Storage for persistence
      await this.azureClient.storeBlob(`files/${fileInfo.hash}`, fileInfo.content);
      
      // Store metadata in Cosmos DB
      await this.azureClient.storeDocument('files', {
        id: fileInfo.hash,
        path: fileInfo.path,
        lastModified: fileInfo.lastModified,
        fileType: fileInfo.fileType,
        size: fileInfo.content.length
      });
      
      this.fileCount++;
    } catch (error) {
      console.error(`Failed to store file ${fileInfo.path}:`, error);
      throw error;
    }
  }

  private async storeFileLocally(fileInfo: FileInfo): Promise<void> {
    const filePath = path.join(this.localCachePath, fileInfo.hash);
    fs.writeFileSync(filePath, fileInfo.content);
    
    // Store a mapping from actual path to hash for quicker lookups
    const mappingsPath = path.join(this.localCachePath, 'path_mappings.json');
    let mappings: Record<string, string> = {};
    
    if (fs.existsSync(mappingsPath)) {
      mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
    }
    
    mappings[fileInfo.path] = fileInfo.hash;
    fs.writeFileSync(mappingsPath, JSON.stringify(mappings, null, 2));
  }

  public async getFile(filePath: string): Promise<string | null> {
    try {
      // Check local cache first
      const mappingsPath = path.join(this.localCachePath, 'path_mappings.json');
      if (fs.existsSync(mappingsPath)) {
        const mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
        const hash = mappings[filePath];
        
        if (hash) {
          const cachedPath = path.join(this.localCachePath, hash);
          if (fs.existsSync(cachedPath)) {
            return fs.readFileSync(cachedPath, 'utf8');
          }
        }
      }
      
      // If not in local cache, try Azure
      const fileMetadata = await this.azureClient.queryDocuments('files', {
        query: 'SELECT * FROM c WHERE c.path = @path',
        parameters: [{ name: '@path', value: filePath }]
      });
      
      if (fileMetadata && fileMetadata.length > 0) {
        const content = await this.azureClient.getBlob(`files/${fileMetadata[0].id}`);
        // Cache it locally for next time
        if (content) {
          this.storeFileLocally({
            path: filePath,
            content,
            hash: fileMetadata[0].id,
            lastModified: fileMetadata[0].lastModified,
            fileType: fileMetadata[0].fileType
          });
        }
        return content;
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to retrieve file ${filePath}:`, error);
      return null;
    }
  }

  public async saveWorkspaceMetadata(metadata: WorkspaceMetadata): Promise<void> {
    try {
      // Store locally
      const metadataPath = path.join(this.localCachePath, 'workspace_metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Store in Cosmos DB
      await this.azureClient.storeDocument('metadata', {
        id: 'workspace',
        ...metadata
      });
    } catch (error) {
      console.error('Failed to save workspace metadata:', error);
      throw error;
    }
  }

  public async storeTaskMetadata(metadata: TaskMetadata): Promise<void> {
    try {
      // Ensure tasks directory exists
      if (!fs.existsSync(this.tasksCachePath)) {
        fs.mkdirSync(this.tasksCachePath, { recursive: true });
      }
      
      // Create a directory for this task
      const taskDirPath = path.join(this.tasksCachePath, metadata.id);
      if (!fs.existsSync(taskDirPath)) {
        fs.mkdirSync(taskDirPath, { recursive: true });
      }
      
      // Save the metadata to the task directory
      const metadataPath = path.join(taskDirPath, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Also save the messages separately for easier access
      const messagesPath = path.join(taskDirPath, 'messages.json');
      fs.writeFileSync(messagesPath, JSON.stringify(metadata.messages, null, 2));
      
      // Update task index
      await this.updateTaskIndex(metadata);
      
      // Store in Azure for backup/sync
      await this.azureClient.storeDocument('tasks', {
        id: metadata.id,
        ...metadata
      });
    } catch (error) {
      console.error(`Failed to store task metadata for task ${metadata.id}:`, error);
      throw error;
    }
  }

  private async updateTaskIndex(taskMetadata: TaskMetadata): Promise<void> {
    try {
      // Path to the task index file
      const indexPath = path.join(this.localCachePath, 'task_index.json');
      
      // Read existing index or create new one
      let taskIndex: { [id: string]: { title: string, timestamp: number, complete: boolean } } = {};
      if (fs.existsSync(indexPath)) {
        taskIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      }
      
      // Update the index with this task
      taskIndex[taskMetadata.id] = {
        title: taskMetadata.title,
        timestamp: taskMetadata.timestamp,
        complete: taskMetadata.complete
      };
      
      // Write the updated index
      fs.writeFileSync(indexPath, JSON.stringify(taskIndex, null, 2));
    } catch (error) {
      console.error('Failed to update task index:', error);
      throw error;
    }
  }

  public async getTaskMetadata(taskId: string): Promise<TaskMetadata | null> {
    try {
      // Check local cache first
      const taskDirPath = path.join(this.tasksCachePath, taskId);
      const metadataPath = path.join(taskDirPath, 'metadata.json');
      
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        return metadata;
      }
      
      // If not in local cache, try Azure
      const taskMetadata = await this.azureClient.queryDocuments('tasks', {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: taskId }]
      });
      
      if (taskMetadata && taskMetadata.length > 0) {
        // Cache it locally for next time
        await this.storeTaskMetadata(taskMetadata[0]);
        return taskMetadata[0];
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to retrieve task metadata for ${taskId}:`, error);
      return null;
    }
  }

  public async getAllTasks(): Promise<TaskMetadata[]> {
    try {
      // Path to the task index file
      const indexPath = path.join(this.localCachePath, 'task_index.json');
      
      if (!fs.existsSync(indexPath)) {
        return [];
      }
      
      // Read task index
      const taskIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      
      // Extract all task IDs
      const taskIds = Object.keys(taskIndex);
      
      // Load all tasks
      const tasks: TaskMetadata[] = [];
      for (const taskId of taskIds) {
        const task = await this.getTaskMetadata(taskId);
        if (task) {
          tasks.push(task);
        }
      }
      
      // Sort by timestamp (newest first)
      return tasks.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to retrieve all tasks:', error);
      return [];
    }
  }

  public async deleteTask(taskId: string): Promise<boolean> {
    try {
      // Path to task directory
      const taskDirPath = path.join(this.tasksCachePath, taskId);
      
      if (!fs.existsSync(taskDirPath)) {
        return false;
      }
      
      // Delete all files in the task directory
      const files = fs.readdirSync(taskDirPath);
      for (const file of files) {
        fs.unlinkSync(path.join(taskDirPath, file));
      }
      
      // Remove the directory
      fs.rmdirSync(taskDirPath);
      
      // Update task index
      const indexPath = path.join(this.localCachePath, 'task_index.json');
      if (fs.existsSync(indexPath)) {
        const taskIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        delete taskIndex[taskId];
        fs.writeFileSync(indexPath, JSON.stringify(taskIndex, null, 2));
      }
      
      // Delete from Azure
      await this.azureClient.deleteDocument('tasks', taskId);
      
      return true;
    } catch (error) {
      console.error(`Failed to delete task ${taskId}:`, error);
      return false;
    }
  }

  public getFileCount(): number {
    return this.fileCount;
  }

  public async search(query: string): Promise<any[]> {
    // Implement search functionality using Azure Cognitive Search
    return this.azureClient.searchCode(query);
  }
}
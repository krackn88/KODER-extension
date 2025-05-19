import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { VectorStore, VectorStoreConfig, VectorUtils } from './vector-store';

/**
 * SQLite implementation of vector store for persistent storage
 */
export class SqliteVectorStore implements VectorStore {
  private db: sqlite3.Database;
  private dimensions: number;
  private defaultThreshold: number;
  private defaultLimit: number;
  private dbPath: string;
  private isInitialized: boolean = false;
  
  /**
   * Create a new SQLite vector store
   * @param config Configuration options
   */
  constructor(config: VectorStoreConfig = {}) {
    this.dimensions = config.dimensions || 384;
    this.defaultThreshold = config.defaultThreshold || 0.7;
    this.defaultLimit = config.defaultLimit || 10;
    
    // Set up the database path
    const storageDir = config.storagePath || path.join(process.cwd(), '.koder-cache');
    
    // Ensure the directory exists
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    
    this.dbPath = path.join(storageDir, 'vectors.db');
    console.log(`SQLite vector store using database at: ${this.dbPath}`);
    
    // Initialize the database connection
    this.db = new sqlite3.Database(this.dbPath);
    
    // Initialize the database schema
    this.initialize();
  }
  
  /**
   * Initialize the database schema
   */
  private async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Create vectors table if it doesn't exist
        this.db.run(`
          CREATE TABLE IF NOT EXISTS vectors (
            id TEXT PRIMARY KEY,
            vector BLOB NOT NULL,
            metadata TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        `, (err) => {
          if (err) {
            console.error('Error creating vectors table:', err);
            reject(err);
            return;
          }
          
          // Create index for faster lookups
          this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_vectors_id ON vectors(id)
          `, (err) => {
            if (err) {
              console.error('Error creating index:', err);
              reject(err);
              return;
            }
            
            this.isInitialized = true;
            resolve();
          });
        });
      });
    });
  }
  
  /**
   * Ensure the database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
  
  /**
   * Serialize a vector to a Buffer
   * @param vector Vector to serialize
   * @returns Buffer representation
   */
  private serializeVector(vector: number[]): Buffer {
    const buffer = Buffer.alloc(vector.length * 4); // 4 bytes per float
    
    for (let i = 0; i < vector.length; i++) {
      buffer.writeFloatLE(vector[i], i * 4);
    }
    
    return buffer;
  }
  
  /**
   * Deserialize a Buffer to a vector
   * @param buffer Buffer representation
   * @returns Deserialized vector
   */
  private deserializeVector(buffer: Buffer): number[] {
    const vector: number[] = [];
    const length = buffer.length / 4; // 4 bytes per float
    
    for (let i = 0; i < length; i++) {
      vector.push(buffer.readFloatLE(i * 4));
    }
    
    return vector;
  }
  
  /**
   * Store a vector with metadata
   * @param id Unique identifier for the vector
   * @param vector The embedding vector
   * @param metadata Additional metadata to store with the vector
   */
  async storeVector(id: string, vector: number[], metadata: any): Promise<void> {
    await this.ensureInitialized();
    
    if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    
    return new Promise((resolve, reject) => {
      const serializedVector = this.serializeVector(vector);
      const serializedMetadata = JSON.stringify(metadata);
      const now = Date.now();
      
      this.db.run(
        'INSERT OR REPLACE INTO vectors (id, vector, metadata, created_at) VALUES (?, ?, ?, ?)',
        [id, serializedVector, serializedMetadata, now],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
  
  /**
   * Retrieve a vector by ID
   * @param id Vector ID
   * @returns The vector and its metadata
   */
  async getVector(id: string): Promise<{ vector: number[], metadata: any } | null> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT vector, metadata FROM vectors WHERE id = ?',
        [id],
        (err, row: { vector: Buffer, metadata: string } | undefined) => {
          if (err) {
            reject(err);
          } else if (!row) {
            resolve(null);
          } else {
            try {
              const vector = this.deserializeVector(row.vector);
              const metadata = JSON.parse(row.metadata);
              resolve({ vector, metadata });
            } catch (parseError) {
              reject(parseError);
            }
          }
        }
      );
    });
  }
  
  /**
   * Search for similar vectors
   * @param vector Query vector
   * @param limit Maximum number of results to return (default: 10)
   * @param threshold Similarity threshold (default: 0.7)
   * @returns Similar vectors with their similarity scores and metadata
   */
  async search(
    vector: number[], 
    limit: number = this.defaultLimit, 
    threshold: number = this.defaultThreshold
  ): Promise<Array<{
    id: string;
    similarity: number;
    vector: number[];
    metadata: any;
  }>> {
    await this.ensureInitialized();
    
    if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    
    // For SQLite, we need to load all vectors and compute similarities in memory
    // This is not efficient for large collections, but works for small to medium datasets
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, vector, metadata FROM vectors',
        [],
        (err, rows: Array<{ id: string, vector: Buffer, metadata: string }>) => {
          if (err) {
            reject(err);
            return;
          }
          
          try {
            const results: Array<{
              id: string;
              similarity: number;
              vector: number[];
              metadata: any;
            }> = [];
            
            for (const row of rows) {
              const storedVector = this.deserializeVector(row.vector);
              const similarity = VectorUtils.cosineSimilarity(vector, storedVector);
              
              if (similarity >= threshold) {
                results.push({
                  id: row.id,
                  similarity,
                  vector: storedVector,
                  metadata: JSON.parse(row.metadata)
                });
              }
            }
            
            // Sort by similarity (highest first) and limit results
            resolve(
              results
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit)
            );
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }
  
  /**
   * Delete a vector by ID
   * @param id Vector ID
   * @returns True if deleted, false if not found
   */
  async deleteVector(id: string): Promise<boolean> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM vectors WHERE id = ?',
        [id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            // Check if any rows were affected
            resolve(this.changes > 0);
          }
        }
      );
    });
  }
  
  /**
   * Get all vector IDs
   * @returns Array of vector IDs
   */
  async getAllIds(): Promise<string[]> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id FROM vectors',
        [],
        (err, rows: Array<{ id: string }>) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map(row => row.id));
          }
        }
      );
    });
  }
  
  /**
   * Clear all vectors from the store
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM vectors', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * Get the number of vectors in the store
   * @returns Number of vectors
   */
  async getCount(): Promise<number> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT COUNT(*) as count FROM vectors',
        [],
        (err, row: { count: number }) => {
          if (err) {
            reject(err);
          } else {
            resolve(row.count);
          }
        }
      );
    });
  }
  
  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{ 
    count: number; 
    dimensions: number;
    dbSize: number;
  }> {
    await this.ensureInitialized();
    
    const count = await this.getCount();
    
    // Get file size of database
    const stats = fs.statSync(this.dbPath);
    
    return {
      count,
      dimensions: this.dimensions,
      dbSize: stats.size // in bytes
    };
  }
  
  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
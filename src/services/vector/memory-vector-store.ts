import { VectorStore, VectorStoreConfig, VectorUtils } from './vector-store';

/**
 * In-memory implementation of vector store for development and testing
 */
export class MemoryVectorStore implements VectorStore {
  private vectors: Map<string, { vector: number[], metadata: any }> = new Map();
  private dimensions: number;
  private defaultThreshold: number;
  private defaultLimit: number;
  
  /**
   * Create a new in-memory vector store
   * @param config Configuration options
   */
  constructor(config: VectorStoreConfig = {}) {
    this.dimensions = config.dimensions || 384;
    this.defaultThreshold = config.defaultThreshold || 0.7;
    this.defaultLimit = config.defaultLimit || 10;
    console.log(`Created MemoryVectorStore with dimensions=${this.dimensions}`);
  }
  
  /**
   * Store a vector with metadata
   * @param id Unique identifier for the vector
   * @param vector The embedding vector
   * @param metadata Additional metadata to store with the vector
   */
  async storeVector(id: string, vector: number[], metadata: any): Promise<void> {
    if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    
    this.vectors.set(id, { vector, metadata });
  }
  
  /**
   * Retrieve a vector by ID
   * @param id Vector ID
   * @returns The vector and its metadata
   */
  async getVector(id: string): Promise<{ vector: number[], metadata: any } | null> {
    const entry = this.vectors.get(id);
    return entry || null;
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
    if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimensions mismatch: expected ${this.dimensions}, got ${vector.length}`);
    }
    
    const results: Array<{
      id: string;
      similarity: number;
      vector: number[];
      metadata: any;
    }> = [];
    
    // Calculate similarity for all vectors
    for (const [id, entry] of this.vectors.entries()) {
      const similarity = VectorUtils.cosineSimilarity(vector, entry.vector);
      
      if (similarity >= threshold) {
        results.push({
          id,
          similarity,
          vector: entry.vector,
          metadata: entry.metadata
        });
      }
    }
    
    // Sort by similarity (highest first) and limit results
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
  
  /**
   * Delete a vector by ID
   * @param id Vector ID
   * @returns True if deleted, false if not found
   */
  async deleteVector(id: string): Promise<boolean> {
    return this.vectors.delete(id);
  }
  
  /**
   * Get all vector IDs
   * @returns Array of vector IDs
   */
  async getAllIds(): Promise<string[]> {
    return Array.from(this.vectors.keys());
  }
  
  /**
   * Clear all vectors from the store
   */
  async clear(): Promise<void> {
    this.vectors.clear();
  }
  
  /**
   * Get the number of vectors in the store
   * @returns Number of vectors
   */
  async getCount(): Promise<number> {
    return this.vectors.size;
  }
  
  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{ 
    count: number; 
    dimensions: number;
    memoryUsage: number;
  }> {
    // Estimate memory usage (very rough approximation)
    // Each number is 8 bytes, plus metadata and overhead
    const totalVectors = this.vectors.size;
    const estimatedMemoryPerVector = this.dimensions * 8 + 100; // 100 bytes overhead
    const estimatedTotalMemory = totalVectors * estimatedMemoryPerVector;
    
    return {
      count: totalVectors,
      dimensions: this.dimensions,
      memoryUsage: estimatedTotalMemory // in bytes
    };
  }
}
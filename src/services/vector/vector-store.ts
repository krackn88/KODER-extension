/**
 * Interface for vector storage and retrieval
 */
export interface VectorStore {
  /**
   * Store a vector with metadata
   * @param id Unique identifier for the vector
   * @param vector The embedding vector
   * @param metadata Additional metadata to store with the vector
   */
  storeVector(id: string, vector: number[], metadata: any): Promise<void>;
  
  /**
   * Retrieve a vector by ID
   * @param id Vector ID
   * @returns The vector and its metadata
   */
  getVector(id: string): Promise<{ vector: number[], metadata: any } | null>;
  
  /**
   * Search for similar vectors
   * @param vector Query vector
   * @param limit Maximum number of results to return
   * @param threshold Similarity threshold (0-1)
   * @returns Similar vectors with their similarity scores and metadata
   */
  search(vector: number[], limit?: number, threshold?: number): Promise<Array<{
    id: string;
    similarity: number;
    vector: number[];
    metadata: any;
  }>>;
  
  /**
   * Delete a vector by ID
   * @param id Vector ID
   * @returns True if deleted, false if not found
   */
  deleteVector(id: string): Promise<boolean>;
  
  /**
   * Get all vector IDs
   * @returns Array of vector IDs
   */
  getAllIds(): Promise<string[]>;
  
  /**
   * Clear all vectors from the store
   */
  clear(): Promise<void>;
}

/**
 * Configuration for vector stores
 */
export interface VectorStoreConfig {
  /** Path to store vector data */
  storagePath?: string;
  
  /** Dimensionality of vectors */
  dimensions?: number;
  
  /** Default similarity threshold */
  defaultThreshold?: number;
  
  /** Default limit for search results */
  defaultLimit?: number;
}

/**
 * Factory to create different vector store implementations
 */
export class VectorStoreFactory {
  /**
   * Create a vector store instance
   * @param type Type of vector store
   * @param config Configuration options
   * @returns VectorStore implementation
   */
  static create(type: 'memory' | 'sqlite' | 'qdrant', config: VectorStoreConfig = {}): VectorStore {
    switch (type) {
      case 'memory':
        return new (require('./memory-vector-store').MemoryVectorStore)(config);
      case 'sqlite':
        return new (require('./sqlite-vector-store').SqliteVectorStore)(config);
      case 'qdrant':
        return new (require('./qdrant-vector-store').QdrantVectorStore)(config);
      default:
        throw new Error(`Unknown vector store type: ${type}`);
    }
  }
}

/**
 * Vector similarity calculation utilities
 */
export class VectorUtils {
  /**
   * Calculate cosine similarity between two vectors
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score (0-1)
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }
    
    let dotProduct = 0;
    let aMagnitude = 0;
    let bMagnitude = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      aMagnitude += a[i] * a[i];
      bMagnitude += b[i] * b[i];
    }
    
    aMagnitude = Math.sqrt(aMagnitude);
    bMagnitude = Math.sqrt(bMagnitude);
    
    if (aMagnitude === 0 || bMagnitude === 0) {
      return 0;
    }
    
    return dotProduct / (aMagnitude * bMagnitude);
  }
  
  /**
   * Calculate Euclidean distance between two vectors
   * @param a First vector
   * @param b Second vector
   * @returns Distance value (lower is more similar)
   */
  static euclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }
    
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    
    return Math.sqrt(sum);
  }
  
  /**
   * Convert Euclidean distance to similarity score (0-1)
   * @param distance Euclidean distance
   * @param maxDistance Maximum expected distance for normalization
   * @returns Similarity score (0-1)
   */
  static distanceToSimilarity(distance: number, maxDistance: number = 2.0): number {
    // Clamp distance to max
    const clampedDistance = Math.min(distance, maxDistance);
    // Convert to similarity (0-1)
    return 1 - (clampedDistance / maxDistance);
  }
}

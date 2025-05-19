# Semantic Code Search in KODER

This document provides a technical overview of how semantic code search is implemented in KODER, including the vector embedding system, database options, and integration with the codebase.

## Overview

KODER's semantic code search allows developers to find similar code snippets across their entire codebase by using vector embeddings and similarity search. This is particularly useful for:

- Finding similar implementations to reuse or standardize
- Identifying code duplication
- Understanding patterns across the codebase
- Finding examples of how to use specific APIs or functions

## Technical Implementation

### 1. Embedding System

Code is converted into high-dimensional vector representations (embeddings) that capture semantic meaning. KODER uses the following process:

1. **Text Chunking**: Code files are split into overlapping chunks (default: 1024 characters with 200 character overlap)
2. **Embedding Generation**: Each chunk is embedded into a high-dimensional vector (default: 384 dimensions)
3. **Storage**: Vectors are stored in a vector database along with metadata (file path, line numbers, etc.)

#### Embedding Sources

KODER can use different sources for generating embeddings:

1. **LLM Service**: If the configured LLM provider supports embeddings, it will be used
2. **Fallback Mechanism**: If no embedding provider is available, a simple hash-based pseudo-embedding is used

```typescript
private async getEmbedding(text: string): Promise<number[]> {
  // Try to get the embedding from the LLM service
  const embedding = await this.llmService.getEmbedding(text);
  
  if (embedding) {
    return embedding;
  }
  
  // If the LLM service doesn't support embeddings, use a fallback
  return this.getFallbackEmbedding(text);
}
```

### 2. Vector Database Options

KODER supports multiple vector database backends:

#### In-Memory Vector Store

- **Use Case**: Development and testing, or for small codebases
- **Advantages**: Fast, no external dependencies
- **Limitations**: Not persistent, limited by available memory

Implementation uses a simple Map to store vectors:

```typescript
class MemoryVectorStore implements VectorStore {
  private vectors: Map<string, { vector: number[], metadata: any }> = new Map();
  // ...
}
```

#### SQLite Vector Store

- **Use Case**: Local persistence for medium-sized codebases
- **Advantages**: Persistent storage, no external dependencies
- **Limitations**: Search performance scales linearly with vector count

The implementation creates a local SQLite database:

```typescript
class SqliteVectorStore implements VectorStore {
  private db: sqlite3.Database;
  // ...
  
  private async initialize(): Promise<void> {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    // ...
  }
}
```

#### Qdrant Integration (Planned)

- **Use Case**: Large codebases with millions of vectors
- **Advantages**: High performance, scalable, optimized for similarity search
- **Limitations**: External dependency, more complex setup

### 3. Similarity Search

Search is implemented using cosine similarity:

```typescript
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
```

### 4. User Interface

KODER provides several ways to interact with the semantic search system:

1. **Context Menu**: Right-click on selected code to search for similar code
2. **Command Palette**: Use the `KODER: Find Similar Code` command
3. **Settings UI**: Configure vector database settings in the KODER sidebar
4. **API**: Use the VectorService in your custom extensions

## Optimizations

Several optimizations make the system efficient for real-world use:

### Chunking Strategy

Code is split into optimally sized chunks for best semantic representation:

```typescript
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
```

### Efficient Storage

Vectors are stored efficiently to minimize disk space and memory usage:

```typescript
private serializeVector(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4); // 4 bytes per float
  
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  
  return buffer;
}
```

### Selective Embedding

Not all files need to be embedded. KODER intelligently skips:

- Binary files and images
- Generated files (e.g., `node_modules`, build outputs)
- Very large files (>100KB)
- Configuration files (e.g., `.json`, `.lock` files)

## Future Work

We're actively working on several improvements:

1. **Incremental Indexing**: Only re-embed changed chunks rather than entire files
2. **Semantic Code Navigation**: Jump directly to semantically related functions
3. **Improved Embeddings**: Specialized code embeddings for better code similarity
4. **Clustering**: Group similar code for better refactoring suggestions
5. **GPU Acceleration**: Support for GPU-accelerated embedding generation and similarity search

## Usage Examples

### Finding Similar Functions

```typescript
// Search for similar code to implement a file reader
async function readFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}
```

### Finding Usage Patterns

```typescript
// Search for places where configuration is loaded
const config = await loadConfig('./config.json');
config.set('debug', true);
applyConfig(config);
```

### Finding Similar Implementations

```typescript
// Find other functions that perform vector similarity calculations
function calculateSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

## Configuration

You can configure the semantic search system in the Vector Database Settings panel in the KODER sidebar.

| Setting | Description | Default |
|---------|-------------|---------|
| Vector Store Type | Type of vector database to use | `sqlite` |
| Dimensions | Number of dimensions in vector embeddings | 384 |
| Chunk Size | Size of text chunks in characters | 1024 |
| Chunk Overlap | Overlap between chunks in characters | 200 |
| Auto-Embedding | Enable automatic embedding of saved documents | true |

## Conclusion

Semantic code search in KODER provides a powerful way to navigate and understand your codebase beyond traditional text-based search. By leveraging vector embeddings and similarity search, you can find semantically similar code even when the syntax differs.

For further development details, refer to the vector service implementation in `src/services/vector-service.ts` and the vector store interfaces in `src/services/vector/`.

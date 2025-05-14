import { BlobServiceClient } from '@azure/storage-blob';
import { CosmosClient } from '@azure/cosmos';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import * as dotenv from 'dotenv';

dotenv.config();

export class AzureClient {
  private blobServiceClient: BlobServiceClient;
  private cosmosClient: CosmosClient;
  private openAIClient: OpenAIClient;
  private containerName: string;
  private databaseName: string;
  private cosmosContainerName: string;

  constructor() {
    // Initialize Azure Blob Storage
    if (!process.env.AZURE_BLOB_CONTAINER) {
      throw new Error('AZURE_BLOB_CONTAINER environment variable not set');
    }
    this.containerName = process.env.AZURE_BLOB_CONTAINER;

    // Initialize Cosmos DB
    if (!process.env.COSMOS_URL || !process.env.COSMOS_KEY || !process.env.COSMOS_DB || !process.env.COSMOS_CONTAINER) {
      throw new Error('Cosmos DB environment variables not set');
    }
    this.databaseName = process.env.COSMOS_DB;
    this.cosmosContainerName = process.env.COSMOS_CONTAINER;

    // Initialize Azure OpenAI
    if (!process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_API_KEY) {
      throw new Error('Azure OpenAI environment variables not set');
    }

    // Create clients
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      `DefaultEndpointsProtocol=https;AccountName=${process.env.AZURE_STORAGE_ACCOUNT};AccountKey=${process.env.AZURE_STORAGE_KEY};EndpointSuffix=core.windows.net`
    );

    this.cosmosClient = new CosmosClient({
      endpoint: process.env.COSMOS_URL,
      key: process.env.COSMOS_KEY
    });

    this.openAIClient = new OpenAIClient(
      process.env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_OPENAI_API_KEY)
    );

    // Ensure containers exist
    this.initializeResources();
  }

  private async initializeResources(): Promise<void> {
    try {
      // Ensure blob container exists
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      await containerClient.createIfNotExists();

      // Ensure Cosmos DB and container exist
      const { database } = await this.cosmosClient.databases.createIfNotExists({
        id: this.databaseName
      });

      await database.containers.createIfNotExists({
        id: this.cosmosContainerName,
        partitionKey: { paths: ["/id"] }
      });

      // Create additional containers for different document types
      await database.containers.createIfNotExists({
        id: 'files',
        partitionKey: { paths: ["/id"] }
      });

      await database.containers.createIfNotExists({
        id: 'metadata',
        partitionKey: { paths: ["/id"] }
      });
      
      // Add tasks container
      await database.containers.createIfNotExists({
        id: 'tasks',
        partitionKey: { paths: ["/id"] }
      });

      console.log('Azure resources initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Azure resources:', error);
      throw error;
    }
  }

  public async storeBlob(blobName: string, content: string): Promise<void> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    await blockBlobClient.upload(content, content.length);
  }

  public async getBlob(blobName: string): Promise<string | null> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      
      const downloadResponse = await blockBlobClient.download(0);
      
      if (downloadResponse.readableStreamBody) {
        const chunks: Buffer[] = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf-8');
      }
      
      return null;
    } catch (error) {
      console.error(`Failed to get blob ${blobName}:`, error);
      return null;
    }
  }

  public async storeDocument(containerName: string, document: any): Promise<void> {
    const container = this.cosmosClient.database(this.databaseName).container(containerName);
    await container.items.upsert(document);
  }
  
  public async deleteDocument(containerName: string, documentId: string): Promise<void> {
    try {
      const container = this.cosmosClient.database(this.databaseName).container(containerName);
      const { resource: doc } = await container.item(documentId, documentId).read();
      
      if (doc) {
        await container.item(documentId, documentId).delete();
      }
    } catch (error) {
      console.error(`Failed to delete document ${documentId} from ${containerName}:`, error);
      throw error;
    }
  }

  public async queryDocuments(containerName: string, querySpec: any): Promise<any[]> {
    try {
      const container = this.cosmosClient.database(this.databaseName).container(containerName);
      const { resources } = await container.items.query(querySpec).fetchAll();
      return resources;
    } catch (error) {
      console.error(`Failed to query documents in ${containerName}:`, error);
      return [];
    }
  }

  public async searchCode(query: string): Promise<any[]> {
    // This would use Azure Cognitive Search
    // For now, just returning empty array
    return [];
  }

  public async askAI(prompt: string, context: string[] = []): Promise<string> {
    try {
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || '';
      
      const response = await this.openAIClient.getChatCompletions(
        deployment,
        [
          { role: 'system', content: 'You are a helpful pair programming assistant that understands code context and provides helpful suggestions.' },
          ...context.map(c => ({ role: 'user' as const, content: c })),
          { role: 'user', content: prompt }
        ],
        { temperature: 0.7, maxTokens: 2000 }
      );

      if (response.choices && response.choices.length > 0 && response.choices[0].message) {
        return response.choices[0].message.content || 'No response from AI';
      }
      
      return 'Failed to get AI response';
    } catch (error) {
      console.error('Failed to get AI response:', error);
      return `Error: ${error}`;
    }
  }
  
  /**
   * Creates a streamed AI chat response
   * @param prompt The user prompt
   * @param context Previous context messages
   * @returns An async generator of response chunks
   */
  public async *createStreamedResponse(prompt: string, context: string[] = []): AsyncGenerator<string> {
    try {
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O || '';
      
      const stream = await this.openAIClient.streamChatCompletions(
        deployment,
        [
          { role: 'system', content: 'You are a helpful pair programming assistant that understands code context and provides helpful suggestions.' },
          ...context.map(c => ({ role: 'user' as const, content: c })),
          { role: 'user', content: prompt }
        ],
        { temperature: 0.7, maxTokens: 4000 }
      );
      
      for await (const chunk of stream) {
        if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].delta?.content) {
          yield chunk.choices[0].delta.content;
        }
      }
    } catch (error) {
      console.error('Failed to get streamed AI response:', error);
      yield `Error: ${error}`;
    }
  }
}
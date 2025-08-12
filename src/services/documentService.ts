// src/services/documentService.ts
import { db } from '../database/db';
import {
  knowledgeDocuments,
  type KnowledgeDocument,
  type NewKnowledgeDocument,
} from '../database/schema';
import { eq, desc, sql, asc } from 'drizzle-orm';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai'; // Correct import for AI SDK embeddings

export interface DocumentSearchResult {
  id: number;
  title: string;
  content: string;
  similarity: number;
  metadata: Record<string, any>;
}

export class DocumentService {
  // ============= EMBEDDING GENERATION =============

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const cleanText = text.replace(/\n/g, ' ').trim();

      // Use AI SDK embed function with OpenAI text embedding model
      const { embedding } = await embed({
        model: openai.textEmbeddingModel('text-embedding-3-small'), // Correct AI SDK syntax
        value: cleanText,
      });

      return embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error('Failed to generate embedding');
    }
  }

  // ============= DOCUMENT OPERATIONS =============

  async addDocument(
    title: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<KnowledgeDocument> {
    try {
      console.log(`📄 Generating embedding for document: ${title}`);

      // Generate embedding for the content
      const embedding = await this.generateEmbedding(content);

      // Store document with embedding
      const documentData: NewKnowledgeDocument = {
        title,
        content,
        embedding,
        metadata: metadata || {},
      };

      const [document] = await db
        .insert(knowledgeDocuments)
        .values(documentData)
        .returning();

      console.log(`✅ Document added successfully: ${document.id}`);
      return document;
    } catch (error) {
      console.error('Error adding document:', error);
      throw new Error('Failed to add document');
    }
  }

  async updateDocument(
    id: number,
    title?: string,
    content?: string,
    metadata?: Record<string, any>
  ): Promise<KnowledgeDocument | null> {
    try {
      const existing = await this.getDocument(id);
      if (!existing) {
        throw new Error('Document not found');
      }

      const updateData: Partial<NewKnowledgeDocument> = {
        updatedAt: new Date(),
      };

      // Update fields if provided
      if (title !== undefined) updateData.title = title;
      if (metadata !== undefined) updateData.metadata = metadata;

      // If content changed, regenerate embedding
      if (content !== undefined) {
        updateData.content = content;
        console.log(`🔄 Regenerating embedding for document: ${id}`);
        updateData.embedding = await this.generateEmbedding(content);
      }

      const [updated] = await db
        .update(knowledgeDocuments)
        .set(updateData)
        .where(eq(knowledgeDocuments.id, id))
        .returning();

      console.log(`✅ Document updated: ${id}`);
      return updated;
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  }

  async deleteDocument(id: number): Promise<boolean> {
    try {
      const result = await db
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, id));

      const success = (result.rowCount || 0) > 0;
      if (success) {
        console.log(`🗑️ Document deleted: ${id}`);
      }
      return success;
    } catch (error) {
      console.error('Error deleting document:', error);
      return false;
    }
  }

  async getDocument(id: number): Promise<KnowledgeDocument | null> {
    try {
      const [document] = await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, id));

      return document || null;
    } catch (error) {
      console.error('Error getting document:', error);
      return null;
    }
  }

  async getAllDocuments(): Promise<KnowledgeDocument[]> {
    try {
      return await db
        .select()
        .from(knowledgeDocuments)
        .orderBy(desc(knowledgeDocuments.createdAt));
    } catch (error) {
      console.error('Error getting all documents:', error);
      return [];
    }
  }

  // ============= VECTOR SEARCH =============

  async searchSimilarDocuments(
    query: string,
    limit: number = 5,
    threshold: number = 0.7
  ): Promise<DocumentSearchResult[]> {
    try {
      console.log(`🔍 Searching for: "${query}" (limit: ${limit})`);

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Perform cosine similarity search
      // Note: We use 1 - cosine_distance to get similarity (higher = more similar)
      const results = await db
        .select({
          id: knowledgeDocuments.id,
          title: knowledgeDocuments.title,
          content: knowledgeDocuments.content,
          metadata: knowledgeDocuments.metadata,
          similarity: sql<number>`1 - (${
            knowledgeDocuments.embedding
          } <=> ${JSON.stringify(queryEmbedding)}::vector)`,
        })
        .from(knowledgeDocuments)
        .where(
          sql`1 - (${knowledgeDocuments.embedding} <=> ${JSON.stringify(
            queryEmbedding
          )}::vector) > ${threshold}`
        )
        .orderBy(
          sql`${knowledgeDocuments.embedding} <=> ${JSON.stringify(
            queryEmbedding
          )}::vector ASC`
        )
        .limit(limit);

      console.log(`📋 Found ${results.length} similar documents`);
      return results;
    } catch (error) {
      console.error('Error searching documents:', error);
      return [];
    }
  }

  async findMostRelevantContent(
    query: string,
    maxResults: number = 3
  ): Promise<string> {
    try {
      const results = await this.searchSimilarDocuments(query, maxResults, 0.5);

      if (results.length === 0) {
        return '';
      }

      // Combine the most relevant content
      const relevantContent = results
        .map((result, index) => {
          const similarity = Math.round(result.similarity * 100);
          return `[Document ${index + 1}] ${
            result.title
          } (${similarity}% match):\n${result.content}`;
        })
        .join('\n\n---\n\n');

      return relevantContent;
    } catch (error) {
      console.error('Error finding relevant content:', error);
      return '';
    }
  }

  // ============= STATISTICS & MONITORING =============

  async getDocumentStats(): Promise<{
    totalDocuments: number;
    avgContentLength: number;
    recentDocuments: number;
  }> {
    try {
      const [stats] = await db
        .select({
          total: sql<number>`count(*)`,
          avgLength: sql<number>`avg(length(content))`,
          recent: sql<number>`count(*) filter (where created_at > now() - interval '7 days')`,
        })
        .from(knowledgeDocuments);

      return {
        totalDocuments: stats.total || 0,
        avgContentLength: Math.round(stats.avgLength || 0),
        recentDocuments: stats.recent || 0,
      };
    } catch (error) {
      console.error('Error getting document stats:', error);
      return {
        totalDocuments: 0,
        avgContentLength: 0,
        recentDocuments: 0,
      };
    }
  }

  // ============= HEALTH CHECK =============

  async healthCheck(): Promise<{
    database: boolean;
    embeddings: boolean;
    vectorSearch: boolean;
  }> {
    try {
      // Test database connectivity
      const dbTest = await db.select().from(knowledgeDocuments).limit(1);
      const database = true;

      // Test embedding generation
      let embeddings = false;
      try {
        await this.generateEmbedding('test');
        embeddings = true;
      } catch (error) {
        console.warn('Embedding generation test failed:', error);
      }

      // Test vector search (if we have documents)
      let vectorSearch = false;
      try {
        const testSearch = await this.searchSimilarDocuments('test', 1);
        vectorSearch = true;
      } catch (error) {
        console.warn('Vector search test failed:', error);
      }

      return { database, embeddings, vectorSearch };
    } catch (error) {
      console.error('Document service health check failed:', error);
      return { database: false, embeddings: false, vectorSearch: false };
    }
  }

  // ============= BATCH OPERATIONS =============

  async addMultipleDocuments(
    documents: Array<{
      title: string;
      content: string;
      metadata?: Record<string, any>;
    }>
  ): Promise<KnowledgeDocument[]> {
    const results: KnowledgeDocument[] = [];

    for (const doc of documents) {
      try {
        const added = await this.addDocument(
          doc.title,
          doc.content,
          doc.metadata
        );
        results.push(added);
      } catch (error) {
        console.error(`Failed to add document: ${doc.title}`, error);
      }
    }

    console.log(
      `📚 Batch operation complete: ${results.length}/${documents.length} documents added`
    );
    return results;
  }

  async clearAllDocuments(): Promise<number> {
    // Only allow in development
    if (process.env.NODE_ENV !== 'development') {
      console.log('⚠️ Clear all documents attempted in production - blocked');
      return 0;
    }

    try {
      const result = await db.delete(knowledgeDocuments);
      const deleted = result.rowCount || 0;
      console.log(`🗑️ Cleared ${deleted} documents (DEBUG)`);
      return deleted;
    } catch (error) {
      console.error('Error clearing documents:', error);
      return 0;
    }
  }
}

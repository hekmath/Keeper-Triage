import { db } from '../database/db';
import {
  knowledgeDocuments,
  knowledgeDocumentChunks,
  type KnowledgeDocument,
  type NewKnowledgeDocument,
  type NewKnowledgeDocumentChunk,
} from '../database/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';
import { splitIntoChunks } from '../utils/chunck';

export interface DocumentSearchResult {
  id: number;
  title: string;
  content: string; // best chunk content (not whole doc)
  similarity: number; // best similarity among chunks
  metadata: Record<string, any>;
}

export class DocumentService {
  // ============= EMBEDDING =============
  async generateEmbedding(text: string): Promise<number[]> {
    const cleanText = text.replace(/\n/g, ' ').trim();
    const { embedding } = await embed({
      model: openai.textEmbeddingModel('text-embedding-3-large'),
      value: cleanText,
    });
    if (embedding.length !== 3072) {
      throw new Error(`Unexpected embedding length: ${embedding.length}`);
    }
    return embedding;
  }

  private async embedChunks(
    chunks: { content: string; index: number }[]
  ): Promise<number[][]> {
    // Batch-embed via multi-value is possible, but simplest is sequential.
    // If you want performance, parallelize with Promise.allSettled and rate-limit.
    const out: number[][] = [];
    for (const ch of chunks) {
      const e = await this.generateEmbedding(ch.content);
      out.push(e);
    }
    return out;
  }

  private static averageVectors(vectors: number[][]): number[] {
    if (vectors.length === 0) return [];
    const dim = vectors[0].length;
    const sum = new Array<number>(dim).fill(0);
    for (const v of vectors) {
      for (let i = 0; i < dim; i++) sum[i] += v[i];
    }
    for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
    return sum;
  }

  // ============= DOCUMENT OPS =============
  async addDocument(
    title: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<KnowledgeDocument> {
    // 1) Insert the doc (embedding will be filled after chunks inserted)
    const baseDoc: NewKnowledgeDocument = {
      title,
      content,
      embedding: null as unknown as number[] | null,
      metadata: metadata || {},
    };
    const [doc] = await db
      .insert(knowledgeDocuments)
      .values(baseDoc)
      .returning();

    // 2) Chunk and embed
    const chunks = splitIntoChunks(content);
    const embeddings = await this.embedChunks(chunks);

    // 3) Insert chunks
    const rows: NewKnowledgeDocumentChunk[] = chunks.map((c, i) => ({
      docId: doc.id,
      chunkIndex: c.index,
      content: c.content,
      embedding: embeddings[i],
    }));
    if (rows.length > 0) {
      await db.insert(knowledgeDocumentChunks).values(rows);
    }

    // 4) Store centroid embedding at doc level (useful for quick doc prefilters)
    if (embeddings.length > 0) {
      const centroid = DocumentService.averageVectors(embeddings);
      await db
        .update(knowledgeDocuments)
        .set({ embedding: centroid, updatedAt: new Date() })
        .where(eq(knowledgeDocuments.id, doc.id));
    }

    return await this.getDocument(doc.id).then((d) => d!);
  }

  async updateDocument(
    id: number,
    title?: string,
    content?: string,
    metadata?: Record<string, any>
  ): Promise<KnowledgeDocument | null> {
    const existing = await this.getDocument(id);
    if (!existing) return null;

    // Update title/metadata/content
    const updateData: Partial<NewKnowledgeDocument> = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (content !== undefined) updateData.content = content;

    const [updated] = await db
      .update(knowledgeDocuments)
      .set(updateData)
      .where(eq(knowledgeDocuments.id, id))
      .returning();

    // If content changed -> rebuild chunks
    if (content !== undefined) {
      // delete old chunks (CASCADE would handle on doc delete only)
      await db
        .delete(knowledgeDocumentChunks)
        .where(eq(knowledgeDocumentChunks.docId, id));

      const chunks = splitIntoChunks(content);
      const embeddings = await this.embedChunks(chunks);

      const rows: NewKnowledgeDocumentChunk[] = chunks.map((c, i) => ({
        docId: id,
        chunkIndex: c.index,
        content: c.content,
        embedding: embeddings[i],
      }));
      if (rows.length > 0) {
        await db.insert(knowledgeDocumentChunks).values(rows);
        // refresh centroid
        const centroid = DocumentService.averageVectors(embeddings);
        await db
          .update(knowledgeDocuments)
          .set({ embedding: centroid, updatedAt: new Date() })
          .where(eq(knowledgeDocuments.id, id));
      } else {
        // empty content edge case
        await db
          .update(knowledgeDocuments)
          .set({ embedding: null as unknown as number[] | null })
          .where(eq(knowledgeDocuments.id, id));
      }
    }

    return updated || null;
  }

  async deleteDocument(id: number): Promise<boolean> {
    const result = await db
      .delete(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getDocument(id: number): Promise<KnowledgeDocument | null> {
    const [document] = await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));
    return document || null;
  }

  async getAllDocuments(): Promise<KnowledgeDocument[]> {
    return await db
      .select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt));
  }

  // ============= VECTOR SEARCH (Chunk-first) =============
  /**
   * Returns top documents, each represented by its best chunk match.
   * We fetch top K chunks, then aggregate per doc and keep the best one per doc.
   */
  async searchSimilarDocuments(
    query: string,
    limit: number = 5,
    threshold: number = 0.05 // keep low; we sort anyway
  ): Promise<DocumentSearchResult[]> {
    // 1) Embed the query
    const q = await this.generateEmbedding(query);

    // 2) Build a pgvector literal safely as "'[a,b,...]'::vector"
    const v = `[${q.join(',')}]`;
    const vLiteral = sql.raw(`'${v}'::vector`);

    // 3) Pull more chunks than limit to allow aggregation by doc
    const CHUNK_MULTIPLIER = 8;
    const rawChunks = await db
      .select({
        docId: knowledgeDocumentChunks.docId,
        chunkIndex: knowledgeDocumentChunks.chunkIndex,
        chunkContent: knowledgeDocumentChunks.content,
        title: knowledgeDocuments.title,
        docContent: knowledgeDocuments.content,
        metadata: knowledgeDocuments.metadata,
        sim: sql<number>`1 - (${knowledgeDocumentChunks.embedding} <=> ${vLiteral})`,
      })
      .from(knowledgeDocumentChunks)
      .innerJoin(
        knowledgeDocuments,
        eq(knowledgeDocumentChunks.docId, knowledgeDocuments.id)
      )
      .where(
        sql`1 - (${knowledgeDocumentChunks.embedding} <=> ${vLiteral}) > ${threshold}`
      )
      .orderBy(
        // smaller distance first => higher similarity; we sorted by sim via where, but keep by exact distance
        sql`${knowledgeDocumentChunks.embedding} <=> ${vLiteral} ASC`
      )
      .limit(limit * CHUNK_MULTIPLIER);

    if (rawChunks.length === 0) return [];

    // 4) Reduce to best chunk per doc
    const byDoc = new Map<
      number,
      {
        docId: number;
        title: string;
        docContent: string;
        bestChunk: string;
        bestSim: number;
        metadata: Record<string, any>;
      }
    >();

    for (const row of rawChunks) {
      const existing = byDoc.get(row.docId);
      if (!existing || row.sim > existing.bestSim) {
        byDoc.set(row.docId, {
          docId: row.docId,
          title: row.title,
          docContent: row.docContent,
          bestChunk: row.chunkContent,
          bestSim: row.sim,
          metadata: row.metadata as any,
        });
      }
    }

    // 5) Sort docs by best similarity desc and take top N
    const topDocs = [...byDoc.values()]
      .sort((a, b) => b.bestSim - a.bestSim)
      .slice(0, limit);

    // 6) Shape the response (content = best chunk snippet)
    return topDocs.map((d) => ({
      id: d.docId,
      title: d.title,
      content: d.bestChunk,
      similarity: d.bestSim,
      metadata: d.metadata || {},
    }));
  }

  async findMostRelevantContent(
    query: string,
    maxResults: number = 3
  ): Promise<string> {
    // Slightly stricter than default, but not too strict
    const results = await this.searchSimilarDocuments(query, maxResults, 0.1);

    if (results.length === 0) return '';

    return results
      .map((r, i) => {
        const pct = Math.round(r.similarity * 100);
        return `[Document ${i + 1}] ${r.title} (${pct}% match):\n${r.content}`;
      })
      .join('\n\n---\n\n');
  }

  // ============= STATS =============
  async getDocumentStats(): Promise<{
    totalDocuments: number;
    avgContentLength: number;
    recentDocuments: number;
  }> {
    const [stats] = await db
      .select({
        total: sql<number>`count(*)`,
        avgLength: sql<number>`avg(length(content))`,
        recent: sql<number>`count(*) filter (where created_at > now() - interval '7 days')`,
      })
      .from(knowledgeDocuments);

    return {
      totalDocuments: stats?.total || 0,
      avgContentLength: Math.round(stats?.avgLength || 0),
      recentDocuments: stats?.recent || 0,
    };
    // (optional) extend to count chunks if you want
  }

  // ============= HEALTH CHECK =============
  async healthCheck(): Promise<{
    database: boolean;
    embeddings: boolean;
    vectorSearch: boolean;
  }> {
    try {
      await db.select().from(knowledgeDocuments).limit(1);
      let embeddings = false;
      try {
        await this.generateEmbedding('healthcheck');
        embeddings = true;
      } catch {
        embeddings = false;
      }
      let vectorSearch = false;
      try {
        await this.searchSimilarDocuments('healthcheck', 1);
        vectorSearch = true;
      } catch {
        vectorSearch = false;
      }
      return { database: true, embeddings, vectorSearch };
    } catch {
      return { database: false, embeddings: false, vectorSearch: false };
    }
  }

  // ============= BULK OPS =============
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
      } catch (e) {
        console.error(`Failed to add document: ${doc.title}`, e);
      }
    }
    return results;
  }

  async clearAllDocuments(): Promise<number> {
    if (process.env.NODE_ENV !== 'development') {
      console.log('⚠️ Clear all documents attempted in production - blocked');
      return 0;
    }
    const result = await db.delete(knowledgeDocuments);
    return result.rowCount || 0;
  }
}

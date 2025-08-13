-- Ensure pgvector is available (safe if already created)
CREATE EXTENSION IF NOT EXISTS vector;

-- Use more memory while building large indexes (optional but helpful)
SET LOCAL maintenance_work_mem = '1GB';

-- ANN index on the doc-level embedding (optional but useful if you still query docs)
CREATE INDEX IF NOT EXISTS knowledge_documents_embedding_cosine_idx
  ON knowledge_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ANN index on the chunk embeddings (the important one)
CREATE INDEX IF NOT EXISTS knowledge_document_chunks_embedding_cosine_idx
  ON knowledge_document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
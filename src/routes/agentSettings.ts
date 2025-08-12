// src/routes/agentSettings.ts
// Add these routes to your main express app or create a new route file

import express, { Router } from 'express';
import { ChatService } from '../services/chatService';

const router: Router = express.Router();
const chatService = new ChatService();

// ============= DOCUMENT MANAGEMENT ROUTES =============

// GET /agent-settings/documents - Get all documents
router.get('/documents', async (req, res) => {
  try {
    const documents = await chatService.getAllDocuments();

    // Include preview and stats
    const documentsWithPreview = documents.map((doc) => ({
      ...doc,
      contentPreview:
        doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
      contentLength: doc.content.length,
    }));

    res.json({
      success: true,
      data: documentsWithPreview,
      total: documents.length,
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch documents',
    });
  }
});

// GET /agent-settings/documents/:id - Get specific document
router.get('/documents/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID',
      });
    }

    const document = await chatService.getDocument(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    res.json({
      success: true,
      data: document,
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch document',
    });
  }
});

// POST /agent-settings/documents - Add new document
router.post('/documents', async (req, res) => {
  try {
    const { title, content, metadata } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Title and content are required',
      });
    }

    if (title.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'Title must be 255 characters or less',
      });
    }

    if (content.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Content must be at least 10 characters long',
      });
    }

    console.log(`📄 Adding new document: ${title}`);

    const document = await chatService.addDocument(
      title,
      content,
      metadata || {}
    );

    res.status(201).json({
      success: true,
      data: document,
      message: 'Document added successfully',
    });
  } catch (error) {
    console.error('Error adding document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add document',
    });
  }
});

// PUT /agent-settings/documents/:id - Update document
router.put('/documents/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, content, metadata } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID',
      });
    }

    // Validation
    if (title && title.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'Title must be 255 characters or less',
      });
    }

    if (content && content.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Content must be at least 10 characters long',
      });
    }

    console.log(`📝 Updating document: ${id}`);

    const document = await chatService.updateDocument(
      id,
      title,
      content,
      metadata
    );

    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    res.json({
      success: true,
      data: document,
      message: 'Document updated successfully',
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update document',
    });
  }
});

// DELETE /agent-settings/documents/:id - Delete document
router.delete('/documents/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document ID',
      });
    }

    console.log(`🗑️ Deleting document: ${id}`);

    const success = await chatService.deleteDocument(id);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
      });
    }

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete document',
    });
  }
});

// POST /agent-settings/documents/search - Search documents
router.post('/documents/search', async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required',
      });
    }

    console.log(`🔍 Searching documents: "${query}"`);

    const results = await chatService.searchDocuments(query, limit);

    res.json({
      success: true,
      data: results,
      query,
      total: results.length,
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search documents',
    });
  }
});

// ============= BULK OPERATIONS =============

// POST /agent-settings/documents/bulk - Add multiple documents
router.post('/documents/bulk', async (req, res) => {
  try {
    const { documents } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Documents array is required',
      });
    }

    // Validate each document
    for (const doc of documents) {
      if (!doc.title || !doc.content) {
        return res.status(400).json({
          success: false,
          error: 'Each document must have title and content',
        });
      }
    }

    console.log(`📚 Adding ${documents.length} documents in bulk`);

    const documentService = chatService.getDocumentService();
    const results = await documentService.addMultipleDocuments(documents);

    res.status(201).json({
      success: true,
      data: results,
      message: `${results.length}/${documents.length} documents added successfully`,
    });
  } catch (error) {
    console.error('Error adding documents in bulk:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add documents in bulk',
    });
  }
});

// ============= STATISTICS AND MONITORING =============

// GET /agent-settings/stats - Get knowledge base statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await chatService.getStats();

    res.json({
      success: true,
      data: {
        knowledgeBase: stats.knowledgeBase,
        system: {
          totalSessions: stats.totalSessions,
          activeSessions: stats.activeSessions,
          totalAgents: stats.totalAgents,
          availableAgents: stats.availableAgents,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
    });
  }
});

// GET /agent-settings/health - Health check for RAG system
router.get('/health', async (req, res) => {
  try {
    const health = await chatService.healthCheck();

    res.json({
      success: true,
      data: health,
      status: health.overall ? 'healthy' : 'degraded',
    });
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check system health',
    });
  }
});

// ============= DEVELOPMENT/DEBUG ROUTES =============

// DELETE /agent-settings/documents/clear-all - Clear all documents (dev only)
router.delete('/documents/clear-all', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      success: false,
      error: 'This operation is only allowed in development mode',
    });
  }

  try {
    const documentService = chatService.getDocumentService();
    const deleted = await documentService.clearAllDocuments();

    res.json({
      success: true,
      message: `Cleared ${deleted} documents`,
      deleted,
    });
  } catch (error) {
    console.error('Error clearing documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear documents',
    });
  }
});

export default router as Router;

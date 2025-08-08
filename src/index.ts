// src/index.ts
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { handleSocketConnection } from './socket/socketHandler';

// Load environment variables

// Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required in .env file');
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// API endpoint to get server info
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Ticketing Chat Backend',
    version: '1.0.0',
    features: {
      ai: true,
      liveChat: true,
      transferToHuman: true,
    },
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  handleSocketConnection(io, socket);
});

// Error handling
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log('╔════════════════════════════════════════╗');
  console.log('║      Ticketing Chat Backend Ready      ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ 🚀 Server: http://localhost:${PORT}       ║`);
  console.log(`║ 🔌 Socket.IO: Connected                ║`);
  console.log(`║ 🤖 OpenAI: Configured                  ║`);
  console.log(
    `║ 🌍 CORS: ${process.env.FRONTEND_URL || 'http://localhost:3000'}    ║`
  );
  console.log('╚════════════════════════════════════════╝');
});

import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';

const port = Number(process.env.PORT ?? 2567);

/** CORS 白名单。逗号分隔；未设置时开发环境放开。 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json());

// Fly.io 健康检查必需
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('heartbeat_dice', GameRoom).filterBy(['roomCode']);

gameServer.listen(port).then(() => {
  console.log(`💗 heartbeat-dice server listening on :${port}`);
});

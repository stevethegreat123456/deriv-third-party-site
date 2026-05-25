import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Server } from "socket.io";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { startBotEngine, initBot } from "./src/server/botEngine.ts";
import { db, waitForAuth } from "./src/server/firebase.ts";
import { collection, query, orderBy, getDocs } from "firebase/firestore";

dotenv.config();

async function startServer() {
  await waitForAuth();
  await initBot();
  
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/stats/all-time", async (req, res) => {
    try {
      if (!db) {
        return res.json({ wins: 0, losses: 0, pnl: 0, totalTrades: 0, winRate: 0, maxConsecutiveLosses: 0, currentConsecutiveLosses: 0 });
      }

      const allQ = query(collection(db, 'bot_trades'), orderBy('timestamp', 'asc'));
      const querySnapshot = await getDocs(allQ);
      const data = querySnapshot.docs.map(d => d.data());
      
      if (!data) {
        return res.json({ wins: 0, losses: 0, pnl: 0, totalTrades: 0, winRate: 0, maxConsecutiveLosses: 0, currentConsecutiveLosses: 0 });
      }

      let wins = 0;
      let losses = 0;
      let pnl = 0;
      let maxConsecutiveLosses = 0;
      let currentConsecutiveLosses = 0;

      for (const t of data) {
        if (t.result === 'won') {
          wins++;
          currentConsecutiveLosses = 0;
        } else if (t.result === 'lost') {
          losses++;
          currentConsecutiveLosses++;
          if (currentConsecutiveLosses > maxConsecutiveLosses) {
            maxConsecutiveLosses = currentConsecutiveLosses;
          }
        }
        pnl += Number(t.pnl) || 0;
      }

      const totalTrades = wins + losses;
      const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;

      res.json({ wins, losses, pnl, totalTrades, winRate, maxConsecutiveLosses, currentConsecutiveLosses });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/ping", (req, res) => {
    res.send("Bot is running!");
  });

  // Start the underlying engine with socket.io
  startBotEngine(io);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

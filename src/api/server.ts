import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import LRUCache from "lru-cache";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());


const API_PORT = Number(process.env.API_PORT ?? "3001");

// -------- Cache (LRU) --------
const cache = new LRUCache<string, unknown>({
  max: 300,
  ttl: 10_000, // 10s
});

// -------- Metrics (Prometheus) --------
const registry = new Registry();
collectDefaultMetrics({ register: registry });

const indexedTransfersTotal = new Gauge({
  name: "indexed_transfers_total",
  help: "Total number of transfers stored in database",
  registers: [registry],
});

const lastProcessedBlockGauge = new Gauge({
  name: "indexer_last_processed_block",
  help: "Last processed block stored in IndexerState",
  registers: [registry],
});

async function refreshMetrics() {
  const st = await prisma.indexerState.findUnique({
    where: { key: "transfer_indexer" },
  });

  if (st) lastProcessedBlockGauge.set(st.lastProcessedBlock);

  const total = await prisma.transfer.count();
  indexedTransfersTotal.set(total);
}

app.get("/", (_req : any, res : any) => {
  res.json({
    name: "ERC20 Transfer Indexer API",
    status: "running",
    endpoints: ["/health", "/transfers", "/stream", "/metrics"],
  });
});

app.get("/health", (_req : any, res : any) => {
  res.json({ ok: true });
});

app.get("/metrics", async (_req : any, res : any) => {
  await refreshMetrics();
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

app.get("/transfers", async (req : any, res : any) => {
  try {
    const cacheKey = req.originalUrl;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit ?? "50"), 200);
    const offset = Number(q.offset ?? "0");

    const where: any = {};

    if (q.sender) where.from = q.sender.toLowerCase();
    if (q.receiver) where.to = q.receiver.toLowerCase();
    if (q.token) where.tokenAddress = q.token.toLowerCase();
    if (q.txHash) where.transactionHash = q.txHash.toLowerCase();

    if (q.blockNumber) {
      where.blockNumber = Number(q.blockNumber);
    } else if (q.fromBlock || q.toBlock) {
      where.blockNumber = {
        ...(q.fromBlock ? { gte: Number(q.fromBlock) } : {}),
        ...(q.toBlock ? { lte: Number(q.toBlock) } : {}),
      };
    }

    const rows = await prisma.transfer.findMany({
      where,
      orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
      take: limit,
      skip: offset,
    });

    const minValue = q.minValue ? BigInt(q.minValue) : null;
    const maxValue = q.maxValue ? BigInt(q.maxValue) : null;

    const filtered = rows.filter((r : any) => {
      const v = BigInt(r.value);
      if (minValue !== null && v < minValue) return false;
      if (maxValue !== null && v > maxValue) return false;
      return true;
    });

    cache.set(cacheKey, filtered);
    return res.json(filtered);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/stream", async (req : any, res : any) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let lastId = Number((req.query.lastId as string | undefined) ?? "0");

  const timer = setInterval(async () => {
    try {
      const rows = await prisma.transfer.findMany({
        where: { id: { gt: lastId } },
        orderBy: { id: "asc" },
        take: 100,
      });

      for (const r of rows) {
        lastId = r.id;
        res.write(`event: transfer\n`);
        res.write(`data: ${JSON.stringify(r)}\n\n`);
      }
    } catch (e) {
      console.error("SSE read error:", e);
    }
  }, 1000);

  req.on("close", () => clearInterval(timer));
});

app.listen(API_PORT, () => {
  console.log(`API running on http://localhost:${API_PORT}`);
});

import { ethers } from "ethers";
import { PrismaClient } from "@prisma/client";
import { TRANSFER_TOPIC, TransferEvent } from "../shared/transfer";

const prisma = new PrismaClient();

const RPC_URL = process.env.RPC_HTTP_URL!;
const START_BLOCK = Number(process.env.START_BLOCK ?? "0");
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? "3");
const CHUNK_SIZE = 10; // Alchemy free tier: eth_getLogs max 10 blocks

const provider = new ethers.JsonRpcProvider(RPC_URL);

function hexToBigIntSafe(hex: string | null | undefined): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function topicToAddress(topic: string) {
  return ethers.getAddress("0x" + topic.slice(26));
}

async function getLastProcessedBlock(): Promise<number> {
  const row = await prisma.indexerState.findUnique({
    where: { key: "transfer_indexer" },
  });

  if (!row) {
    await prisma.indexerState.create({
      data: {
        key: "transfer_indexer",
        lastProcessedBlock: START_BLOCK - 1,
        updatedAt: Math.floor(Date.now() / 1000),
      },
    });
    return START_BLOCK - 1;
  }

  return row.lastProcessedBlock;
}

async function setLastProcessedBlock(block: number) {
  await prisma.indexerState.upsert({
    where: { key: "transfer_indexer" },
    update: {
      lastProcessedBlock: block,
      updatedAt: Math.floor(Date.now() / 1000),
    },
    create: {
      key: "transfer_indexer",
      lastProcessedBlock: block,
      updatedAt: Math.floor(Date.now() / 1000),
    },
  });
}

async function saveTransfers(events: TransferEvent[]) {
  if (!events.length) return;

  // SQLite-safe: use upsert (no createMany skipDuplicates)
  for (const e of events) {
    await prisma.transfer.upsert({
      where: {
        transactionHash_logIndex: {
          transactionHash: e.transactionHash,
          logIndex: e.logIndex,
        },
      },
      update: {},
      create: {
        transactionHash: e.transactionHash,
        blockNumber: e.blockNumber,
        blockTimestamp: e.blockTimestamp,
        logIndex: e.logIndex,
        tokenAddress: e.tokenAddress,
        from: e.from,
        to: e.to,
        value: e.value.toString(),
      },
    });
  }
}

async function decodeLog(log: ethers.Log): Promise<TransferEvent> {
  if (!log.topics || log.topics.length < 3) {
    throw new Error("Invalid Transfer log: not enough topics");
  }

  const block = await provider.getBlock(log.blockNumber);
  if (!block) throw new Error("Block not found");

  return {
    transactionHash: log.transactionHash.toLowerCase(),
    blockNumber: log.blockNumber,
    blockTimestamp: block.timestamp,
    logIndex: log.index,
    tokenAddress: log.address.toLowerCase(),
    from: topicToAddress(log.topics[1]!).toLowerCase(),
    to: topicToAddress(log.topics[2]!).toLowerCase(),
    value: hexToBigIntSafe(log.data),
  };
}

async function backfill(fromBlock: number, toBlock: number) {
  console.log(`Backfill from ${fromBlock} to ${toBlock} (chunk=${CHUNK_SIZE})`);

  let totalLogs = 0;

  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);

    const logs = await provider.getLogs({
      fromBlock: start,
      toBlock: end,
      topics: [TRANSFER_TOPIC],
    });

    totalLogs += logs.length;

    const decoded: TransferEvent[] = [];
    for (const l of logs) decoded.push(await decodeLog(l));

    await saveTransfers(decoded);
    await setLastProcessedBlock(end);

    console.log(`blocks [${start}-${end}] logs=${logs.length} total=${totalLogs}`);
  }

  console.log(`Done. Total logs processed: ${totalLogs}`);
}

async function startRealtime() {
  const wsUrl = process.env.RPC_WS_URL;
  const pollMs = Number(process.env.POLL_INTERVAL_MS ?? "5000");

  // Polling fallback (works even without WS)
  if (!wsUrl) {
    console.log("No RPC_WS_URL provided, realtime will use polling only.");
    setInterval(async () => {
      const head = await provider.getBlockNumber();
      const safeHead = Math.max(0, head - CONFIRMATIONS);
      const last = await getLastProcessedBlock();
      if (last < safeHead) await backfill(last + 1, safeHead);
    }, pollMs);
    return;
  }

  const connect = () => new ethers.WebSocketProvider(wsUrl);
  let ws = connect();

  const filter = { topics: [TRANSFER_TOPIC] };

  let healthTimer: NodeJS.Timeout | null = null;
  let reconnecting = false;

  const attach = () => {
    ws.on(filter, async () => {
      try {
        // reorg-safe: catch up to safe head instead of trusting the single event
        const head = await provider.getBlockNumber();
        const safeHead = Math.max(0, head - CONFIRMATIONS);
        const last = await getLastProcessedBlock();
        if (last < safeHead) await backfill(last + 1, safeHead);
      } catch (e) {
        console.error("Realtime handler error:", e);
      }
    });

    // health-check: if provider becomes unhealthy, reconnect
    healthTimer = setInterval(async () => {
      try {
        await ws.getBlockNumber();
      } catch {
        console.log("WS healthcheck failed -> reconnecting...");
        await reconnect();
      }
    }, 15000);
  };

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;

    try {
      if (healthTimer) clearInterval(healthTimer);
      ws.removeAllListeners();
      (ws as any).destroy?.(); // best-effort cleanup
    } catch {}

    await new Promise((r) => setTimeout(r, 1000));

    ws = connect();
    attach();

    reconnecting = false;
    console.log("WS reconnected.");
  }

  attach();
  console.log("Realtime indexing ON (WS + safe catch-up).");
}

async function run() {
  console.log("Starting ERC20 Transfer indexer...");

  const head = await provider.getBlockNumber();
  const safeHead = Math.max(0, head - CONFIRMATIONS);

  const last = await getLastProcessedBlock();
  const fromBlock = Math.max(last + 1, START_BLOCK);

  if (fromBlock > safeHead) {
    console.log(
      `Nothing to backfill: fromBlock (${fromBlock}) > safeHead (${safeHead})`
    );
  } else {
    await backfill(fromBlock, safeHead);
  }

  await startRealtime();
  console.log("Indexer ready (backfill done + realtime running).");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

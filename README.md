# ERC20 Transfer Indexer

TD – Decentralized Finance  
Workshop: Indexing ERC20 Transfers

---

## Overview

This project implements an indexer for the ERC20 `Transfer` event.

It listens to the standard event: Transfer(address indexed from, address indexed to, uint256 value)

Event Topic : 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef


The goal is to:

- Index historical Transfer events
- Listen to new events in real time
- Store them in a database
- Expose a REST API for querying
- Provide basic monitoring and a simple UI

---

## Architecture

The system is composed of three parts:

### 1. Indexer

The indexer:

- Connects to an Ethereum RPC provider (Infura / Alchemy)
- Fetches historical logs using `eth_getLogs`
- Listens to new logs via WebSocket
- Handles reconnection in case of errors
- Stores events in the database
- Saves the last processed block to allow resume after restart

---

### 2. API

The API exposes:

- `GET /transfers`  
  Query indexed transfers with filters

- `GET /stream`  
  Live updates using Server-Sent Events (SSE)

- `GET /metrics`  
  Prometheus-compatible metrics endpoint

---

### 3. Database

SQLite database using Prisma ORM.

Tables:

- `Transfer`
- `IndexerState`

Constraints:

- Unique `(transactionHash, logIndex)`
- Indexed fields: `from`, `to`, `tokenAddress`, `blockNumber`

---

## Data Model

```ts
interface TransferEvent {
  transactionHash: string
  blockNumber: number
  blockTimestamp: number
  logIndex: number
  tokenAddress: string
  from: string
  to: string
  value: bigint
}
```
---
## API Usage
Example query
```bash
GET /transfers?sender=0x123...&fromBlock=5000000&limit=20
```
Available filters:
- sender
- receiver
- token
- txHash
- blockNumber
- fromBlock
- toBlock
- minValue
- maxValue
- limit
- offset
---

## Installation
Requirements
- Node.js 20+
- PNPM
- Ethereum RPC provider (Infura or Alchemy)

1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/indexing.git
cd indexing
```
2. Install dependencies
```bash
pnpm install
```
3. Configure environment
Create a .env file
```ini
DATABASE_URL="file:./dev.db"

RPC_HTTP_URL="https://sepolia.infura.io/v3/YOUR_KEY"
RPC_WS_URL="wss://sepolia.infura.io/ws/v3/YOUR_KEY"

START_BLOCK=0
CONFIRMATIONS=3
API_PORT=3001
```
4. Run database migration
```nginx
pnpm prisma migrate dev
```
5. Start the services
Indexer:
```css
pnpm --filter indexer dev
```
API:
```css
pnpm --filter api dev
```
Frontend:
```css
pnpm --filter web dev
```
Open:
```arduino
http://localhost:3000
```
---
## License 
MIT




-- CreateTable
CREATE TABLE "Transfer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "blockTimestamp" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "lastProcessedBlock" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "Transfer_from_idx" ON "Transfer"("from");

-- CreateIndex
CREATE INDEX "Transfer_to_idx" ON "Transfer"("to");

-- CreateIndex
CREATE INDEX "Transfer_tokenAddress_idx" ON "Transfer"("tokenAddress");

-- CreateIndex
CREATE INDEX "Transfer_blockNumber_idx" ON "Transfer"("blockNumber");

-- CreateIndex
CREATE INDEX "Transfer_transactionHash_idx" ON "Transfer"("transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_transactionHash_logIndex_key" ON "Transfer"("transactionHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerState_key_key" ON "IndexerState"("key");

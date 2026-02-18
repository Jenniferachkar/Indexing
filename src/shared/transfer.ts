export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface TransferEvent {
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
  logIndex: number;
  tokenAddress: string;
  from: string;
  to: string;
  value: bigint;
}

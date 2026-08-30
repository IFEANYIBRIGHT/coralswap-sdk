import { ConfigError } from "../errors";

export enum Network {
  MAINNET = "MAINNET",
  TESTNET = "TESTNET",
  LOCAL = "LOCAL",
}

export interface NetworkConfig {
  network: Network;
  networkPassphrase: string;
  rpcUrl: string;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  [Network.MAINNET]: {
    network: Network.MAINNET,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://soroban-rpc.stellar.org",
  },
  [Network.TESTNET]: {
    network: Network.TESTNET,
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  [Network.LOCAL]: {
    network: Network.LOCAL,
    networkPassphrase: "Standalone Network ; February 2017",
    rpcUrl: "http://localhost:8000",
  },
};

export function getNetworkConfig(
  network: Network,
  rpcUrl?: string,
): NetworkConfig {
  const base = NETWORKS[network];
  if (!base) {
    throw new ConfigError(`unknown network: ${String(network)}`);
  }
  return { ...base, rpcUrl: rpcUrl ?? base.rpcUrl };
}
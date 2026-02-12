export interface ComplianceRpc {
	isBtcBlocked: (btcAddresses: string[]) => Promise<Record<string, boolean>>;
}

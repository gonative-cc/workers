import { Transaction, payments, script, type Network } from "bitcoinjs-lib";
import { logError } from "@gonative-cc/lib/logger";
import type { Input } from "bitcoinjs-lib/src/transaction";

function extractAddressFromInput(input: Input, network: Network): string | undefined {
	try {
		if (input.witness && input.witness.length >= 2) {
			const pubKey = input.witness[1];
			const { address } = payments.p2wpkh({ pubkey: pubKey, network });
			return address;
		}

		const scriptSig = input?.script;
		if (scriptSig && scriptSig.length >= 65) {
			const chunks = script.decompile(scriptSig);
			if (!chunks) return;

			const pubKey = chunks[chunks.length - 1] as Buffer;
			const { address } = payments.p2pkh({ pubkey: pubKey, network });
			return address;
		}
	} catch (e) {
		logError({ method: "extractAddressFromInput", msg: "Failed to extract address" }, e);
	}
}

export function extractSenderAddresses(tx: Transaction, btcNet: Network): string[] {
	if (tx.ins.length === 0) return [];

	const addresses: string[] = [];
	for (const input of tx.ins) {
		const addr = extractAddressFromInput(input, btcNet);
		if (addr) addresses.push(addr);
	}
	return addresses;
}

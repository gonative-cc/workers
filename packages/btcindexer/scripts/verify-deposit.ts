import { readFileSync, existsSync } from "fs";
import { Transaction, address, networks } from "bitcoinjs-lib";
import { parseSuiRecipientFromOpReturn } from "../src/btcindexer";

const OP_RETURN = 0x6a;

interface ValidationResult {
	valid: boolean;
	errors: string[];
	deposit?: {
		vout: number;
		amount_sats: number;
		sui_recipient: string;
		btc_address: string;
	};
}

function validateDepositTx(
	txHex: string,
	depositAddr: string,
	network: networks.Network,
): ValidationResult {
	const errors: string[] = [];
	let tx: Transaction;

	try {
		tx = Transaction.fromHex(txHex);
	} catch (e) {
		return {
			valid: false,
			errors: [`Failed to parse transaction: ${e instanceof Error ? e.message : String(e)}`],
		};
	}

	let suiRecipient: string | null = null;
	let opReturnCount = 0;

	for (const vout of tx.outs) {
		const recipient = parseSuiRecipientFromOpReturn(vout.script);
		if (recipient) {
			opReturnCount++;
			suiRecipient = recipient;
		}
	}

	if (opReturnCount === 0) {
		errors.push("Missing OP_RETURN field");
	} else if (opReturnCount > 1) {
		errors.push(`Multiple OP_RETURN found (${opReturnCount}), expected only 1`);
	}

	let depositVout = -1;
	let depositAmount = 0;

	for (let i = 0; i < tx.outs.length; i++) {
		const vout = tx.outs[i];
		if (!vout || vout.script[0] === OP_RETURN) {
			continue;
		}

		try {
			const btcAddr = address.fromOutputScript(vout.script, network);
			if (btcAddr === depositAddr) {
				depositVout = i;
				depositAmount = Number(vout.value);
				break;
			}
		} catch {}
	}

	if (depositVout === -1) {
		errors.push(`No output found paying to deposit address: ${depositAddr}`);
	}

	const valid = errors.length === 0;

	if (valid && suiRecipient) {
		return {
			valid: true,
			errors: [],
			deposit: {
				vout: depositVout,
				amount_sats: depositAmount,
				sui_recipient: suiRecipient,
				btc_address: depositAddr,
			},
		};
	}

	return { valid, errors };
}

const args = process.argv.slice(2);
if (args.length < 3) {
	console.error("Usage: bun verify-deposit.ts <tx-hex-or-file> <deposit-address> <network>");
	process.exit(1);
}

const [txInput, depositAddr, networkName] = args;

const networkMap: Record<string, networks.Network> = {
	mainnet: networks.bitcoin,
	testnet: networks.testnet,
	regtest: networks.regtest,
};

const network = networkMap[networkName!];
if (!network) {
	console.error(`Invalid network: ${networkName}. Use: mainnet, testnet, or regtest`);
	process.exit(1);
}

try {
	let txHex: string;
	if (existsSync(txInput!)) {
		txHex = readFileSync(txInput!, "utf8").trim();
	} else {
		txHex = txInput!.trim();
	}

	const result = validateDepositTx(txHex, depositAddr!, network);
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.valid ? 0 : 1);
} catch (e) {
	console.error(
		JSON.stringify(
			{
				valid: false,
				errors: [`Error: ${e instanceof Error ? e.message : String(e)}`],
			},
			null,
			2,
		),
	);
	process.exit(1);
}

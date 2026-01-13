import { Buffer } from "node:buffer";
import { fromBase64 } from "@mysten/sui/utils";

const MOCK_DATA = {
	// "dummy_bitcoin_transaction_id" in Base64
	btc_tx_id: "ZHVtbXlfYml0Y29pbl90cmFuc2FjdGlvbl9pZA==",
	// "dummy_script_publickey_data" in Base64
	btc_script_publickey: "ZHVtbXlfc2NyaXB0X3B1YmxpY2tleV9kYXRh",
};

console.log("⚔️  Comparing Old vs. New Implementation\n");

// --- 1. Transaction ID Comparison ---
console.log("🔍 Comparing TX ID Decoding (Reverse + Hex):");

// OLD WAY: Node.js Buffer
const oldTxId = Buffer.from(MOCK_DATA.btc_tx_id, "base64").reverse().toString("hex");

// NEW WAY: Sui SDK
const newTxId = fromBase64(MOCK_DATA.btc_tx_id).reverse().toHex();

console.log(`   Old (Buffer):  ${oldTxId}`);
console.log(`   New (SDK):     ${newTxId}`);
console.log(`   Match?         ${oldTxId === newTxId ? "✅ YES" : "❌ NO"}\n`);

// --- 2. Script Pubkey Comparison ---
console.log("🔍 Comparing Script Pubkey Decoding (Base64 -> Bytes):");

// OLD WAY: Node.js Buffer
const oldScript = Buffer.from(MOCK_DATA.btc_script_publickey, "base64");

// NEW WAY: Sui SDK
const newScript = fromBase64(MOCK_DATA.btc_script_publickey);

// Compare the actual byte values
const isByteMatch =
	oldScript.length === newScript.length && oldScript.every((val, i) => val === newScript[i]);

console.log(`   Old (Buffer):  [${Uint8Array.from(oldScript)}]`);
console.log(`   New (SDK):     [${newScript}]`);
console.log(`   Match?         ${isByteMatch ? "✅ YES" : "❌ NO"}`);

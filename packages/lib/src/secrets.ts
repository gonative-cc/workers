import { logger } from "./logger";

interface SecretStore {
	get(): Promise<string>;
}

/**
 * Retrieves the mnemonic from the secrets store with proper error handling.
 * Returns the mnemonic string or null if not found/failed.
 */
export async function getMnemonic(secret: SecretStore): Promise<string | null> {
	try {
		const mnemonic = await secret.get();
		if (!mnemonic) {
			logger.error({ msg: "Missing NBTC_MINTING_SIGNER_MNEMONIC" });
			return null;
		}
		return mnemonic;
	} catch (error) {
		logger.error({ msg: "Failed to retrieve NBTC_MINTING_SIGNER_MNEMONIC", error });
		return null;
	}
}

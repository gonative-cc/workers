interface SecretStore {
	get(): Promise<string>;
}

/**
 * Retrieves a secret from the secrets store.
 * Throws if the secret is not found or retrieval fails.
 */
export async function getSecret(secret: SecretStore): Promise<string> {
	const value = await secret.get();
	if (!value) {
		throw new Error("Secret not found in store");
	}
	return value;
}

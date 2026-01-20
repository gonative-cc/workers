import { SuiGraphQLClient as Client } from "@mysten/sui/graphql";
import { bcs } from "@mysten/bcs";
import { logger } from "@gonative-cc/lib/logger";

export class SuiGraphQLClient {
	private client: Client;
	private readonly batchSize: number;

	constructor(endpoint: string, batchSize = 50) {
		this.client = new Client({ url: endpoint });
		this.batchSize = batchSize;
	}

	async checkMintedStatus(tableId: string, txIds: string[]): Promise<Set<string>> {
		if (txIds.length === 0) return new Set();

		const mintedTxIds = new Set<string>();
		for (let i = 0; i < txIds.length; i += this.batchSize) {
			const batch = txIds.slice(i, i + this.batchSize);
			const query = this.buildMintedCheckQuery(batch);
			const variables = this.buildVariables(tableId, batch);

			try {
				const result = await this.client.query({
					query: query,
					variables: variables,
				});
				const data = result.data as Record<
					string,
					{ dynamicField?: { name: { json: unknown } } } | undefined
				>;

				if (!data) continue;

				batch.forEach((txId, index) => {
					const alias = `tx${index}`;
					const fieldData = data[alias];
					// If dynamicField is not null, the key exists in the table
					if (fieldData?.dynamicField) {
						mintedTxIds.add(txId);
					}
				});
			} catch (error) {
				logger.error({
					msg: "Error checking minted status via GraphQL",
					tableId,
					error,
				});
			}
		}

		return mintedTxIds;
	}

	private buildMintedCheckQuery(txIds: string[]): string {
		const queries = txIds.map((_, i) => {
			return `
        tx${i}: object(address: $tableId) {
          dynamicField(name: { type: "vector<u8>", bcs: $bcs${i} }) {
            name { json }
          }
        }`;
		});

		const variableDefinitions = txIds.map((_, i) => `$bcs${i}: Base64!`).join(", ");

		return `query CheckMintedStatus($tableId: SuiAddress!, ${variableDefinitions}) {
      ${queries.join("\n")}
    }`;
	}

	private buildVariables(tableId: string, txIds: string[]): Record<string, string> {
		const variables: Record<string, string> = { tableId };

		txIds.forEach((txId, i) => {
			// REVERSE the buffer to match on-chain Little Endian storage for TXIDs
			const bytes = Uint8Array.from(Buffer.from(txId, "hex").reverse());
			const bcsEncoded = bcs.vector(bcs.u8()).serialize(bytes).toBase64();
			variables[`bcs${i}`] = bcsEncoded;
		});

		return variables;
	}
}

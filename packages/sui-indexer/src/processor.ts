import type { NetworkConfig, PkgCfg } from "./models";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SuiEventHandler } from "./handler";
import type { EventFetcher } from "./graphql-client";
import { getNetworkConfig } from "@ika.xyz/sdk";

interface EventSource {
	cursorId: number;
	setupId: number;
	pkg: string;
	module: string;
	isCoordinator: boolean;
}

export class Processor {
	netCfg: NetworkConfig;
	storage: D1Storage;
	eventFetcher: EventFetcher;

	constructor(netCfg: NetworkConfig, storage: D1Storage, eventFetcher: EventFetcher) {
		this.netCfg = netCfg;
		this.storage = storage;
		this.eventFetcher = eventFetcher;
	}

	async pollEvents(nbtcPkgs: PkgCfg[]) {
		if (nbtcPkgs.length === 0) return;

		const nbtcSources: EventSource[] = nbtcPkgs.map((pkg) => ({
			cursorId: pkg.id,
			setupId: pkg.id,
			pkg: pkg.nbtc_pkg,
			module: "nbtc",
			isCoordinator: false,
		}));
		await this.pollEventSources(nbtcSources);
		await this.pollIkaEvents();
	}

	// Ika SDK only provides package addresses for mainnet and testnet
	private async pollIkaEvents() {
		const network = this.netCfg.name;
		if (network !== "mainnet" && network !== "testnet") return;

		const coordinatorPkg = getNetworkConfig(network).packages.ikaSystemPackage;
		// cursorId -1 to avoid collisions with nBTC cursor IDs (positive)
		const sources: EventSource[] = [
			{
				cursorId: -1,
				setupId: -1,
				pkg: coordinatorPkg,
				module: "coordinator_inner",
				isCoordinator: true,
			},
		];
		await this.pollEventSources(sources);
	}

	private async pollEventSources(sources: EventSource[]) {
		try {
			const cursors = await this.storage.getMultipleSuiGqlCursors(
				sources.map((p) => p.cursorId),
			);

			let hasAnyNextPage = true;
			while (hasAnyNextPage) {
				const fetchRequests = sources.map((p) => ({
					id: p.pkg,
					module: p.module,
					cursor: cursors[p.cursorId] || null,
				}));

				const results = await this.eventFetcher.fetchEvents(fetchRequests);
				const cursorsToSave: { setupId: number; cursor: string }[] = [];
				hasAnyNextPage = false;

				for (const p of sources) {
					const key = `${p.pkg}::${p.module}`;
					const result = results[key];
					if (!result) continue;

					logger.debug({
						msg: `Fetched events`,
						network: this.netCfg.name,
						module: p.module,
						setupId: p.setupId,
						eventsLength: result.events.length,
					});

					let processingSucceeded = true;
					if (result.events.length > 0) {
						try {
							const handler = new SuiEventHandler(this.storage, p.setupId);
							if (p.isCoordinator) {
								await handler.handleIkaEvents(result.events);
							} else {
								await handler.handleEvents(result.events);
							}
						} catch (error) {
							processingSucceeded = false;
							logError(
								{
									msg: "Failed to process events",
									method: "pollEventSources",
									setupId: p.setupId,
									module: p.module,
								},
								error,
							);
						}
					}

					// Only advance cursor if processing succeeded
					if (
						processingSucceeded &&
						result.endCursor &&
						result.endCursor !== cursors[p.cursorId]
					) {
						cursorsToSave.push({ setupId: p.cursorId, cursor: result.endCursor });
						cursors[p.cursorId] = result.endCursor;
					}

					if (result.hasNextPage) {
						hasAnyNextPage = true;
					}
				}

				if (cursorsToSave.length > 0) {
					await this.storage.saveMultipleSuiGqlCursors(cursorsToSave);
				}
			}
		} catch (e) {
			logError(
				{
					msg: "Failed to poll event sources",
					method: "pollEventSources",
					network: this.netCfg.name,
				},
				e,
			);
		}
	}
}

import type { NetworkConfig, PkgCfg } from "./models";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SuiEventHandler } from "./handler";
import type { EventFetcher } from "./graphql-client";
import { getNetworkConfig } from "@ika.xyz/sdk";
import type { SuiClient } from "./redeem-sui-client";
import type { SuiNet } from "@gonative-cc/lib/nsui";

export class Processor {
	netCfg: NetworkConfig;
	storage: D1Storage;
	eventFetcher: EventFetcher;
	suiClients?: Map<SuiNet, SuiClient>;

	constructor(
		netCfg: NetworkConfig,
		storage: D1Storage,
		eventFetcher: EventFetcher,
		suiClients?: Map<SuiNet, SuiClient>,
	) {
		this.netCfg = netCfg;
		this.storage = storage;
		this.eventFetcher = eventFetcher;
		this.suiClients = suiClients;
	}

	// Polls events (nBTC + Ika coordinator) from multiple packages
	async pollEvents(nbtcPkgs: PkgCfg[]) {
		try {
			if (nbtcPkgs.length === 0) return;

			// Get coordinator package from Ika SDK
			const network = this.netCfg.name;
			const coordinatorPkg =
				network === "mainnet" || network === "testnet"
					? getNetworkConfig(network).packages.ikaSystemPackage
					: null;

			const packages: {
				cursorId: number;
				setupId: number;
				pkg: string;
				module: string;
				isCoordinator: boolean;
			}[] = [];

			for (const pkg of nbtcPkgs) {
				packages.push({
					cursorId: pkg.id,
					setupId: pkg.id,
					pkg: pkg.nbtc_pkg,
					module: "nbtc",
					isCoordinator: false,
				});
			}

			if (coordinatorPkg) {
				packages.push({
					cursorId: -1,
					setupId: -1,
					pkg: coordinatorPkg,
					module: "coordinator_inner",
					isCoordinator: true,
				});
			}

			const cursors = await this.storage.getMultipleSuiGqlCursors(
				packages.map((p) => p.cursorId),
			);

			let hasAnyNextPage = true;
			while (hasAnyNextPage) {
				const fetchRequests = packages.map((p) => ({
					id: p.pkg,
					module: p.module,
					cursor: cursors[p.cursorId] || null,
				}));

				const results = await this.eventFetcher.fetchEvents(fetchRequests);
				const cursorsToSave: { setupId: number; cursor: string }[] = [];
				hasAnyNextPage = false;

				for (const p of packages) {
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
							const handler = new SuiEventHandler(
								this.storage,
								p.setupId,
								this.suiClients,
							);
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
									method: "pollEvents",
									setupId: p.setupId,
									module: p.module,
								},
								error,
							);
						}
					}

					// Only advance cursor if processing succeeded or there were no events to process
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
					msg: "Failed to index packages",
					method: "pollEvents",
					network: this.netCfg,
				},
				e,
			);
		}
	}
}

import type { NetworkConfig, PkgCfg } from "./models";
import { IndexerStorage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SuiEventHandler } from "./handler";
import type { EventFetcher } from "./graphql-client";

export class Processor {
	netCfg: NetworkConfig;
	storage: IndexerStorage;
	eventFetcher: EventFetcher;

	constructor(netCfg: NetworkConfig, storage: IndexerStorage, eventFetcher: EventFetcher) {
		this.netCfg = netCfg;
		this.storage = storage;
		this.eventFetcher = eventFetcher;
	}

	// Poll all events (nBTC + Ika coordinator) from multiple packages
	async pollAllEvents(nbtcPkgs: PkgCfg[]) {
		try {
			if (nbtcPkgs.length === 0) return;

			const allPackages: {
				cursorId: number;
				setupId: number;
				pkg: string;
				module: string;
				isCoordinator: boolean;
			}[] = [];

			for (const pkg of nbtcPkgs) {
				allPackages.push({
					cursorId: pkg.id,
					setupId: pkg.id,
					pkg: pkg.nbtc_pkg,
					module: "nbtc",
					isCoordinator: false,
				});

				if (pkg.coordinator_pkg) {
					allPackages.push({
						cursorId: -pkg.id, // negative to keep cursors separate from nbtc cursors
						setupId: pkg.id,
						pkg: pkg.coordinator_pkg,
						module: "coordinator_inner",
						isCoordinator: true,
					});
				}
			}

			const cursors = await this.storage.getMultipleSuiGqlCursors(
				allPackages.map((p) => p.cursorId),
			);

			let hasAnyNextPage = true;
			while (hasAnyNextPage) {
				const packages = allPackages.map((p) => ({
					id: p.pkg,
					module: p.module,
					cursor: cursors[p.cursorId] || null,
				}));

				const results = await this.eventFetcher.fetchEvents(packages);
				const cursorsToSave: { setupId: number; cursor: string }[] = [];
				hasAnyNextPage = false;

				for (const p of allPackages) {
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

					if (result.events.length > 0) {
						try {
							const handler = new SuiEventHandler(this.storage, p.setupId);
							if (p.isCoordinator) {
								await handler.handleIkaEvents(result.events);
							} else {
								await handler.handleEvents(result.events);
							}
						} catch (error) {
							logError(
								{
									msg: "Failed to process events",
									method: "pollAllEvents",
									setupId: p.setupId,
									module: p.module,
								},
								error,
							);
						}
					}

					if (result.endCursor && result.endCursor !== cursors[p.cursorId]) {
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
					method: "pollAllEvents",
					network: this.netCfg,
				},
				e,
			);
		}
	}
}

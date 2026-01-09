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

	// pool Nbtc events by multiple package ids
	async poolAllNbtcEvents(nbtcPkgs: PkgCfg[]) {
		try {
			if (nbtcPkgs.length === 0) return;

			const setupIds = nbtcPkgs.map((pkg) => pkg.id);
			const cursors = await this.storage.getMultipleSuiGqlCursors(setupIds);

			let hasAnyNextPage = true;
			while (hasAnyNextPage) {
				const packages = nbtcPkgs.map((pkg) => ({
					id: pkg.nbtc_pkg,
					cursor: cursors[pkg.id] || null,
				}));

				const results = await this.eventFetcher.fetchMultipleEvents(packages);

				const cursorsToSave: { setupId: number; cursor: string }[] = [];
				hasAnyNextPage = false;

				for (const pkg of nbtcPkgs) {
					const result = results[pkg.nbtc_pkg];
					if (!result) continue;

					logger.debug({
						msg: `Fetched events`,
						network: this.netCfg.name,
						nbtcPkgs,
						eventsLength: result.events.length,
						endCursor: result.endCursor,
					});

					if (result.events.length > 0) {
						const handler = new SuiEventHandler(
							this.storage,
							pkg.nbtc_pkg,
							this.netCfg.name,
						);
						await handler.handleEvents(result.events);
					}

					if (result.endCursor && result.endCursor !== cursors[pkg.id]) {
						cursorsToSave.push({ setupId: pkg.id, cursor: result.endCursor });
						cursors[pkg.id] = result.endCursor;
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
					msg: "Failed to index package",
					method: "queryNewEvents",
					network: this.netCfg,
					pkgIds: nbtcPkgs,
				},
				e,
			);
		}
	}

	// pool Nbtc events by single package id
	async poolNbtcEvents(nbtcPkg: PkgCfg) {
		await this.poolAllNbtcEvents([nbtcPkg]);
	}
}

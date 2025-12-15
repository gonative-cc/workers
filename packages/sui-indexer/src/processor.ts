import type { NetworkConfig } from "./models";
import { IndexerStorage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SuiEventHandler } from "./handler";
import type { EventFetcher, EventsBatch, Cursor } from "./graphql-client";

export class Processor {
	netCfg: NetworkConfig;
	storage: IndexerStorage;
	eventFetcher: EventFetcher;

	constructor(netCfg: NetworkConfig, storage: IndexerStorage, eventFetcher: EventFetcher) {
		this.netCfg = netCfg;
		this.storage = storage;
		this.eventFetcher = eventFetcher;
	}

	async poolNbtcEvents(nbtcPkg: string) {
		let cursor = null;
		try {
			cursor = await this.storage.getSuiGqlCursor(nbtcPkg);
			let hasNextPage = true;
			while (hasNextPage) {
				const b = await this._poolNbtc(nbtcPkg, cursor);
				if (b.endCursor && b.endCursor !== cursor) {
					await this.storage.saveSuiGqlCursor(nbtcPkg, b.endCursor);
					hasNextPage = b.hasNextPage;
				} else {
					hasNextPage = false;
				}
			}
		} catch (e) {
			logError(
				{
					msg: "Failed to index package",
					method: "queryNewEvents",
					network: this.netCfg,
					pkgId: nbtcPkg,
					startCursor: cursor,
				},
				e,
			);
		}
	}

	private async _poolNbtc(nbtcPkg: string, startCursor: Cursor): Promise<EventsBatch> {
		const network = this.netCfg.name;
		// TODO: lets fetch events from all active packages at once
		const b = await this.eventFetcher.fetchEvents(nbtcPkg, startCursor);
		logger.debug({
			msg: `Fetched events`,
			network: network,
			packageId: nbtcPkg,
			eventsLength: b.events.length,
			startCursor,
			endCursor: b.endCursor,
		});
		if (b.events.length > 0) {
			const handler = new SuiEventHandler(this.storage, nbtcPkg, network);
			await handler.handleEvents(b.events);
		}
		return b;
	}
}

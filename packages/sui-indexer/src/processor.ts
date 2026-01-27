import type { NbtcPkg } from "./models";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { SuiEventHandler } from "./handler";
import type { Cursor, EventFetcher, EventFetcherArg, PageInfo } from "./graphql-client";
import type { SuiNet } from "@gonative-cc/lib/nsui";

const nbtcModule = "nbtc";

type NbtcPkgWithCursors = [NbtcPkg, PageInfo];

export class Processor {
	constructor(
		private storage: D1Storage,
		private eventFetcher: EventFetcher,
		private net: SuiNet,
	) {}

	// poll Nbtc events and process them by network
	async run() {
		// NOTE: with the current setup, we can only handle indexing one module per package!
		const nbtcPkgs = this.storage.getNbtcPkgs(this.net);
		logger.info({
			msg: `Processing network`,
			network: this.net,
			nbtcPkgsCount: nbtcPkgs.length,
		});

		if (!nbtcPkgs.length) return;

		try {
			const cursors = await this.storage.getNbtcGqlCursors(this.net);
			const nbtcWithCursors: NbtcPkgWithCursors[] = nbtcPkgs.map((p) => [
				p,
				{ hasNextPage: true, endCursor: cursors[p.setup_id] || null },
			]);
			let hasNextPage = true;
			while (hasNextPage) {
				await this.indexNbtc(nbtcWithCursors);
				hasNextPage = false;
				for (const o of nbtcWithCursors) {
					hasNextPage = hasNextPage || o[1].hasNextPage;
				}
			}

			const cursorsToSave = nbtcWithCursors.map(([nbtc, pageInfo]) => ({
				setupId: nbtc.setup_id,
				cursor: pageInfo.endCursor,
			}));
			await this.storage.saveNbtcGqlCursors(cursorsToSave);
		} catch (e) {
			logError(
				{
					msg: "Failed to index packages",
					method: "queryNewEvents",
					network: this.net,
				},
				e,
			);
		}
	}

	async indexNbtc(nbtcPkgs: NbtcPkgWithCursors[]) {
		const fetcherArgs: EventFetcherArg[] = [];
		for (let index = 0; index < nbtcPkgs.length; ++index) {
			const [pkg, c] = nbtcPkgs[index]!;
			if (c.hasNextPage)
				fetcherArgs.push({
					module: pkg.nbtc_pkg + "::nbtc",
					cursor: c.endCursor,
					index,
				});
		}

		const results = await this.eventFetcher.fetchEvents(fetcherArgs);
		for (const [resultIdx, result] of results.entries()) {
			const nbtc = nbtcPkgs[resultIdx]![0];

			logger.debug({
				msg: `Fetched events`,
				network: this.net,
				nbtcPkg: nbtc.nbtc_pkg,
				eventsLength: result.events.length,
				endCursor: result.pageInfo.endCursor,
			});

			if (result.events.length > 0) {
				const handler = new SuiEventHandler(this.storage, nbtc.setup_id);
				await handler.handleEvents(result.events);
			}

			nbtcPkgs[resultIdx]![1] = result.pageInfo;
		}
	}
}

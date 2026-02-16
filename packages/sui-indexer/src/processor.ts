// TODO: rename this module to indexer.ts

import type { NbtcPkg } from "./models";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";
import { IkaEventHandler, NbtcEventHandler } from "./handler";
import type { Cursor, EventFetcher, EventFetcherArg, PageInfo } from "./graphql-client";
import type { SuiNet } from "@gonative-cc/lib/nsui";
import type { SuiClient } from "./redeem-sui-client";

const nbtcModule = "nbtc";

type NbtcPkgWithCursors = [NbtcPkg, PageInfo];

export class Processor {
	constructor(
		private net: SuiNet,
		private storage: D1Storage,
		private suiClient: SuiClient,
		private eventFetcher: EventFetcher,
	) {}

	// poll Nbtc events and process them by network
	// NOTE: with the current setup, we can only handle indexing one module per package!
	async run() {
		await this.indexNbtc();
	}

	// TODO: we should simplify: there should be only one pkg / network / env.
	async indexNbtc() {
		const nbtcPkgs = this.storage.getNbtcPkgs(this.net);
		logger.debug({
			msg: `Indexing Nbtc Pkgs`,
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
				await this.indexNbtcCursorStep(nbtcWithCursors);
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

	async indexIka() {
		// TODO: replicate indexNbtc

		// const ikaCursors = await storage.getIkaCoordinatorPkgsWithCursors(netCfg.name);
		// const ikaPkgIds = Object.keys(ikaCursors);
		// if (ikaPkgIds.length > 0) {
		// 	logger.info({
		// 		msg: `Processing IKA coordinator events`,
		// 		network: netCfg.name,
		// 		packageCount: ikaPkgIds.length,
		// 	});
		// 	await p.pollIkaEvents(ikaCursors);
		// }

		const nbtcPkgs = this.storage.getNbtcPkgs(this.net);
		logger.debug({
			msg: `Indexing Nbtc Pkgs`,
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
				await this.indexNbtcCursorStep(nbtcWithCursors);
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

	async indexNbtcCursorStep(nbtcPkgs: NbtcPkgWithCursors[]) {
		const fetcherArgs: EventFetcherArg[] = [];
		for (let index = 0; index < nbtcPkgs.length; ++index) {
			const [pkg, c] = nbtcPkgs[index]!;
			if (c.hasNextPage)
				fetcherArgs.push({
					module: pkg.nbtc_pkg + "::" + nbtcModule,
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
				const handler = new NbtcEventHandler(this.storage, nbtc.setup_id);
				await handler.handleEvents(result.events);
			}

			nbtcPkgs[resultIdx]![1] = result.pageInfo;
		}
	}

	// TODO: integrate that with run
	// TODO: Refactor pollAllNbtcEvents and pollIkaEvents into a single generic pollEvents function
	// that accepts package config and handles both event types with their respective cursor storage.

	async pollIkaEvents(cursors: Record<string, string | null>) {
		const coordinatorPkgIds = Object.keys(cursors);
		try {
			if (coordinatorPkgIds.length === 0) return;

			let hasNextPage = true;
			while (hasNextPage) {
				const packages = coordinatorPkgIds.map((pkgId) => ({
					id: pkgId,
					cursor: cursors[pkgId] || null,
					module: "coordinator_inner",
				}));

				const results = await this.eventFetcher.fetchEvents(packages);

				const cursorsToSave: { ikaPkg: string; cursor: string }[] = [];
				hasNextPage = false;

				for (const pkgId of coordinatorPkgIds) {
					const result = results[pkgId];
					if (!result) continue;

					logger.debug({
						msg: "Fetched IKA events",
						network: this.netCfg.name,
						coordinatorPkgId: pkgId,
						eventsLength: result.events.length,
						endCursor: result.endCursor,
					});

					if (result.events.length > 0) {
						const handler = new IkaEventHandler(this.storage, this.suiClient);
						await handler.handleEvents(result.events);
					}

					if (result.endCursor && result.endCursor !== cursors[pkgId]) {
						cursorsToSave.push({
							ikaPkg: pkgId,
							cursor: result.endCursor,
						});
						cursors[pkgId] = result.endCursor;
					}

					if (result.hasNextPage) {
						hasNextPage = true;
					}
				}

				if (cursorsToSave.length > 0) {
					await this.storage.saveIkaCursors(this.netCfg.name, cursorsToSave);
				}
			}
		} catch (e) {
			logError(
				{
					msg: "Failed to index IKA coordinator events",
					method: "pollIkaEvents",
					network: this.netCfg,
					coordinatorPkgIds,
				},
				e,
			);
		}
	}
}

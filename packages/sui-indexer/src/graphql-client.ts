import { GraphQLClient } from "graphql-request";
import type { SuiEventNode } from "./models";

const EVENTS_PER_PAGE = 50;

export type Cursor = string | null;

export interface PageInfo {
	hasNextPage: boolean;
	endCursor: Cursor;
}

export interface EventsBatch {
	events: SuiEventNode[];
	pageInfo: PageInfo;
}

export interface EventFetcherArg {
	module: string; // pkg_id::module
	cursor: string | null;
	index: number | string; // used to index entries
}

export interface EventFetcher {
	fetchEvents: (modules: EventFetcherArg[]) => Promise<EventsBatch[]>;
}

interface ModuleEventsResponse {
	events: {
		pageInfo: PageInfo;
		nodes: {
			timestamp: string; // ISO timestamp string
			contents: {
				type: {
					repr: string; // full event type string
				};
				json: unknown; // event data
			};
			transaction: {
				digest: string;
			};
		}[];
	};
}

function buildMultipleEventsQuery(numModules: number): string {
	const variables = [];
	const queries = [];

	for (let i = 0; i < numModules; i++) {
		variables.push(`$filter${i}: String!`, `$cursor${i}: String`);
		queries.push(`
			events${i}: events(filter: { module: $filter${i} }, first: ${EVENTS_PER_PAGE}, after: $cursor${i}) {
				pageInfo {
					hasNextPage
					endCursor
				}
				nodes {
					timestamp
					contents {
						type {
							repr
						}
						json
					}
					transaction {
						digest
					}
				}
			}`);
	}

	return `query FetchMultipleModuleEvents(${variables.join(", ")}) {${queries.join("")}
	}`;
}

export class SuiGraphQLClient implements EventFetcher {
	private client: GraphQLClient;

	constructor(endpoint: string) {
		this.client = new GraphQLClient(endpoint);
	}

	// returns list of fetched EventBatch in the same order as the modules. EventBatch can be null
	// if the response could not be obtained
	async fetchEvents(modules: EventFetcherArg[]): Promise<EventsBatch[]> {
		if (modules.length === 0) return [];

		const query = buildMultipleEventsQuery(modules.length);
		const variables: Record<string, string | null> = {};

		modules.forEach((m, i) => {
			variables[`filter${i}`] = m.module;
			variables[`cursor${i}`] = m.cursor;
		});

		const data = await this.client.request<Record<string, ModuleEventsResponse["events"]>>(
			query,
			variables,
		);

		return modules.map((_, i) => {
			const eventsData = data[`events${i}`]!;

			const events: SuiEventNode[] = eventsData.nodes.map((node) => ({
				type: node.contents.type.repr,
				json: node.contents.json,
				timestamp: node.timestamp,
				txDigest: node.transaction.digest,
			}));

			return {
				events,
				pageInfo: eventsData.pageInfo,
			};
		});
	}
}

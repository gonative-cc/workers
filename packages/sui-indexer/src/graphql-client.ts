import { GraphQLClient } from "graphql-request";
import type { SuiEventNode } from "./models";

const EVENTS_PER_PAGE = 50;

export type Cursor = string | null;

export interface EventsBatch {
	events: SuiEventNode[];
	endCursor: Cursor;
	hasNextPage: boolean;
}

export interface EventFetcher {
	fetchEvents: (
		packages: { id: string; cursor: string | null; module?: string }[],
	) => Promise<Record<string, EventsBatch>>;
}

interface ModuleEventsResponse {
	events: {
		pageInfo: {
			hasNextPage: boolean;
			endCursor: Cursor;
		};
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

function buildMultipleEventsQuery(packageCount: number): string {
	const variables = [];
	const queries = [];

	for (let i = 0; i < packageCount; i++) {
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

	async fetchEvents(
		packages: { id: string; cursor: string | null; module?: string }[],
	): Promise<Record<string, EventsBatch>> {
		if (packages.length === 0) return {};

		const query = buildMultipleEventsQuery(packages.length);
		const variables: Record<string, string | null> = {};

		packages.forEach((pkg, i) => {
			variables[`filter${i}`] = `${pkg.id}::${pkg.module ?? "nbtc"}`;
			variables[`cursor${i}`] = pkg.cursor;
		});

		const data = await this.client.request<Record<string, ModuleEventsResponse["events"]>>(
			query,
			variables,
		);

		const result: Record<string, EventsBatch> = {};
		packages.forEach((pkg, i) => {
			const eventsData = data[`events${i}`];
			if (eventsData) {
				const events: SuiEventNode[] = eventsData.nodes.map((node) => ({
					type: node.contents.type.repr,
					json: node.contents.json,
					timestamp: node.timestamp,
					txDigest: node.transaction.digest,
				}));

				result[pkg.id] = {
					events,
					endCursor: eventsData.pageInfo.endCursor,
					hasNextPage: eventsData.pageInfo.hasNextPage,
				};
			}
		});

		return result;
	}
}

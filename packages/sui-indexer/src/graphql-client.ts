import { GraphQLClient, gql } from "graphql-request";
import type { SuiEventNode } from "./models";

export type Cursor = string | null;

export interface EventsBatch {
	events: SuiEventNode[];
	endCursor: Cursor;
	hasNextPage: boolean;
}

export interface EventFetcher {
	fetchEvents: (packageId: string, cursor: string | null) => Promise<EventsBatch>;
	fetchMultipleEvents: (
		packages: { id: string; cursor: string | null }[],
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

// After modyfying this query, make sure to update the corresponding types in ModuleEventsResponse
const MODULE_EVENTS_QUERY = gql`
	query FetchModuleEvents($filter: String!, $cursor: String) {
		events(filter: { module: $filter }, first: 50, after: $cursor) {
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
		}
	}
`;

function buildMultipleEventsQuery(packageCount: number): string {
	const variables = [];
	const queries = [];

	for (let i = 0; i < packageCount; i++) {
		variables.push(`$filter${i}: String!`, `$cursor${i}: String`);
		queries.push(`
			events${i}: events(filter: { module: $filter${i} }, first: 50, after: $cursor${i}) {
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

	async fetchEvents(packageId: string, cursor: string | null): Promise<EventsBatch> {
		const filter = `${packageId}::nbtc`;
		const data = await this.client.request<ModuleEventsResponse>(MODULE_EVENTS_QUERY, {
			filter,
			cursor,
		});

		const events: SuiEventNode[] = data.events.nodes.map((node) => ({
			type: node.contents.type.repr,
			json: node.contents.json,
			timestamp: node.timestamp,
			txDigest: node.transaction.digest,
		}));

		return {
			events,
			endCursor: data.events.pageInfo.endCursor,
			hasNextPage: data.events.pageInfo.hasNextPage,
		};
	}

	async fetchMultipleEvents(
		packages: { id: string; cursor: string | null }[],
	): Promise<Record<string, EventsBatch>> {
		if (packages.length === 0) return {};

		const query = buildMultipleEventsQuery(packages.length);
		const variables: Record<string, string | null> = {};

		packages.forEach((pkg, i) => {
			variables[`filter${i}`] = `${pkg.id}::nbtc`;
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

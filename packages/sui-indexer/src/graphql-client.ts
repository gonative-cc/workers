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
			}
		}
	}
`;

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
		}));

		return {
			events,
			endCursor: data.events.pageInfo.endCursor,
			hasNextPage: data.events.pageInfo.hasNextPage,
		};
	}
}

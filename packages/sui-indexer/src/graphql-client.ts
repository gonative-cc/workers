import { GraphQLClient, gql } from "graphql-request";
import type { SuiEventNode } from "./models";

interface ModuleEventsResponse {
	events: {
		pageInfo: {
			hasNextPage: boolean;
			endCursor: string | null;
		};
		nodes: {
			json: unknown;
			type: string;
			timestampMs: string;
		}[];
	};
}

const MODULE_EVENTS_QUERY = gql`
	query FetchModuleEvents($packageId: String!, $cursor: String) {
		events(
			filter: { emittingModule: { package: $packageId, module: "nbtc" } }
			first: 50
			after: $cursor
		) {
			pageInfo {
				hasNextPage
				endCursor
			}
			nodes {
				json
				type
				timestampMs
			}
		}
	}
`;

export class SuiGraphQLClient {
	private client: GraphQLClient;

	constructor(endpoint: string) {
		this.client = new GraphQLClient(endpoint);
	}

	async fetchEvents(packageId: string, cursor: string | null) {
		const data = await this.client.request<ModuleEventsResponse>(MODULE_EVENTS_QUERY, {
			packageId,
			module: "nbtc",
			cursor,
		});

		const events: SuiEventNode[] = data.events.nodes.map((node) => ({
			type: node.type,
			json: node.json,
			timestamp: node.timestampMs,
		}));

		return {
			events,
			nextCursor: data.events.pageInfo.hasNextPage ? data.events.pageInfo.endCursor : null,
		};
	}
}

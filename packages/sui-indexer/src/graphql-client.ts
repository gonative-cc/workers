import { GraphQLClient, gql } from "graphql-request";
import type { MintEventNode } from "./models";

interface MintEventsResponse {
	events: {
		pageInfo: {
			hasNextPage: boolean;
			endCursor: string | null;
		};
		nodes: {
			json: unknown;
		}[];
	};
}

const MINT_EVENT_QUERY = gql`
	query FetchMintEvents($eventType: String!, $cursor: String) {
		events(filter: { eventType: $eventType }, first: 50, after: $cursor) {
			pageInfo {
				hasNextPage
				endCursor
			}
			nodes {
				json
			}
		}
	}
`;

export class SuiGraphQLClient {
	private client: GraphQLClient;

	constructor(endpoint: string) {
		this.client = new GraphQLClient(endpoint);
	}

	async fetchMintEvents(
		packageId: string,
		cursor: string | null,
	): Promise<{ events: MintEventNode[]; nextCursor: string | null }> {
		const eventType = `${packageId}::nbtc::MintEvent`;
		const data = await this.client.request<MintEventsResponse>(MINT_EVENT_QUERY, {
			eventType,
			cursor,
		});

		return {
			events: data.events.nodes as MintEventNode[],
			nextCursor: data.events.pageInfo.hasNextPage ? data.events.pageInfo.endCursor : null,
		};
	}
}

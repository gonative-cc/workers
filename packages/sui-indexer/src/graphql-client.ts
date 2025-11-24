import { GraphQLClient, gql } from "graphql-request";

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
	query FetchMintEvents($packageId: String!, $cursor: String) {
		events(
			filter: {
				emittingModule: { package: $packageId, module: "nbtc" }
				eventType: "MintEvent"
			}
			first: 50
			after: $cursor
		) {
			pageInfo {
				hasNextPage
				endCursor
			}
			nodes {
				cursor
				json
				timestamp
			}
		}
	}
`;

export class SuiGraphQLClient {
	private client: GraphQLClient;

	constructor(endpoint: string) {
		this.client = new GraphQLClient(endpoint);
	}

	async fetchMintEvents(packageId: string, cursor: string | null) {
		const data = await this.client.request<MintEventsResponse>(MINT_EVENT_QUERY, {
			packageId,
			cursor,
		});

		return {
			events: data.events.nodes,
			nextCursor: data.events.pageInfo.hasNextPage ? data.events.pageInfo.endCursor : null,
		};
	}
}

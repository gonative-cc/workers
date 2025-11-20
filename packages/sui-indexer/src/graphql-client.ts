import { GraphQLClient, gql } from "graphql-request";

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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const data = await this.client.request<any>(MINT_EVENT_QUERY, {
			packageId,
			cursor,
		});

		return {
			events: data.events.nodes,
			nextCursor: data.events.pageInfo.hasNextPage ? data.events.pageInfo.endCursor : null,
		};
	}
}

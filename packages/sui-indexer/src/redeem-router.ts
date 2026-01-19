import { Router, error, json, type IRequest } from "itty-router";
import type { AppRouter, CFArgs } from "./redeem-routertype";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { btcNetFromString } from "@gonative-cc/lib/nbtc";
import { D1Storage } from "./storage";
import { logError, logger } from "@gonative-cc/lib/logger";

export default class HttpRouter {
	#router: AppRouter;

	constructor() {
		this.#router = this.createRouter();
	}

	createRouter() {
		const r = Router<IRequest, CFArgs>({
			catch: error,
			finally: [json],
		});

		r.get("/redeems/:address", this.getRedeemsBySuiAddr);

		r.all("/*", () => error(404, "Wrong Endpoint"));
		return r;
	}

	fetch = async (req: Request, env: Env, ctx: ExecutionContext) => {
		logger.debug({ msg: "Incoming request", url: req.url, method: req.method });
		return this.#router.fetch(req, env, ctx);
	};

	getRedeemsBySuiAddr = async (req: IRequest, env: Env) => {
		const params = req.params;
		if (!params || !params.address) {
			return error(400, "Missing address parameter");
		}
		if (!isValidSuiAddress(params.address)) {
			return error(400, "Invalid SUI address format.");
		}

		const networkStr = req.query.network;
		if (!networkStr || typeof networkStr !== "string") {
			return error(400, "Missing or invalid network query parameter.");
		}

		try {
			const btcNetwork = btcNetFromString(networkStr);
			const storage = new D1Storage(env.DB);
			const redeems = await storage.getRedeemsByAddrAndNetwork(params.address, btcNetwork);
			return redeems;
		} catch (e: unknown) {
			logError({ msg: "Failed to fetch redeems", method: "getRedeemsBySuiAddr" }, e);
			const msg = e instanceof Error ? e.message : "Invalid request";
			return error(400, msg);
		}
	};
}

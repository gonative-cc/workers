import { Router, error, json, type IRequest } from "itty-router";
import type { AppRouter, CFArgs } from "./redeem-routertype";
import { isValidSuiAddress } from "@mysten/sui/utils";
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
		const setupId = Number(req.query.setup_id);
		const errs = [];
		if (!isValidSuiAddress(params.address)) {
			errs.push("Invalid SUI address format.");
		}
		if (!Number.isInteger(setupId) || setupId < 0) {
			errs.push("Missing or invalid setup_id query parameter.");
		}
		if (errs.length !== 0) {
			return error(400, errs.join(" "));
		}

		try {
			const storage = new D1Storage(env.DB);
			return storage.getRedeemsBySuiAddr(setupId, params.address);
		} catch (e: unknown) {
			logError({ msg: "Failed to fetch redeems", method: "getRedeemsBySuiAddr" }, e);
			const msg = e instanceof Error ? e.message : "Invalid request";
			return error(400, msg);
		}
	};
}

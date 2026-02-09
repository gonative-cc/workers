import { logError } from "@gonative-cc/lib/logger";

/**
 * Verifies that the request contains a valid Bearer token matching the env secret.
 * @param request The incoming HTTP request
 * @param env The environment object containing the RELAYER_AUTH_TOKEN
 * @returns true if authorized, false otherwise
 */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
	if (!env.RELAYER_AUTH_TOKEN) {
		logError({
			msg: "RELAYER_AUTH_TOKEN is not configured in environment",
			method: "isAuthorized",
		});
		return false;
	}

	const authHeader = request.headers.get("Authorization");
	if (!authHeader) {
		return false;
	}

	const token = authHeader.trim().replace(/^Bearer\s+/i, "");
	const secretValue = await env.RELAYER_AUTH_TOKEN.get();
	return token === secretValue;
}

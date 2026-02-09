/**
 * Verifies that the request contains a valid Bearer token matching the env secret.
 * @param request The incoming HTTP request
 * @param env The environment object containing the RELAYER_AUTH_TOKEN
 * @returns true if authorized, false otherwise
 */
export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader || !env.RELAYER_AUTH_TOKEN) {
		return false;
	}
	const token = authHeader.trim().replace(/^Bearer\s+/i, "");
	const secretValue = await env.RELAYER_AUTH_TOKEN.get();
	return token === secretValue;
}

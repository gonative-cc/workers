import { timingSafeEqual } from "node:crypto";

/**
 * Validates the Authorization header from request headers against an expected secret.
 * @param headers The request Headers object
 * @param expectedSecret The expected secret from environment variables
 * @returns true if authorized, false otherwise
 */
export function isAuthorized(headers: Headers, expectedSecret: string | undefined): boolean {
	if (!expectedSecret) {
		return false;
	}

	const authHeader = headers.get("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return false;
	}

	const token = authHeader.substring(7);

	if (token.length !== expectedSecret.length) {
		return false;
	}

	// we do that to prevent timing attacks
	const encoder = new TextEncoder();
	return timingSafeEqual(encoder.encode(token), encoder.encode(expectedSecret));
}

import { timingSafeEqual } from "node:crypto";

/**
 * Validates a token against an expected secret using constant-time comparison.
 * @param token The token extracted from the Authorization header
 * @param expectedSecret The expected secret from environment variables
 * @returns true if authorized, false otherwise
 */
export function isAuthorized(token: string | null, expectedSecret: string | undefined): boolean {
	if (!expectedSecret || !token) {
		return false;
	}

	if (token.length !== expectedSecret.length) {
		return false;
	}

	// we do that to prevent timing attacks
	const encoder = new TextEncoder();
	return timingSafeEqual(encoder.encode(token), encoder.encode(expectedSecret));
}

/**
 * Extracts the Bearer token from the Authorization header.
 * @param authHeader The value of the Authorization header
 * @returns The token if found and correctly formatted, null otherwise
 */
export function extractBearerToken(authHeader: string | null): string | null {
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return null;
	}
	return authHeader.substring(7);
}

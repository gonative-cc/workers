export interface Context {
	msg: string;
	method: string;
	[key: string]: unknown;
}

interface LogData {
	msg: string;
	[key: string]: unknown;
}

function log(level: "debug" | "info" | "warn" | "error", data: LogData) {
	const output = { ...data, level };
	console[level === "info" ? "log" : level](JSON.stringify(output));
}

export const logger = {
	debug: (data: LogData) => log("debug", data),
	info: (data: LogData) => log("info", data),
	warn: (data: LogData) => log("warn", data),
	error: (data: LogData) => log("error", data),
};

export function logError(ctx: Context, error?: unknown) {
	if (error !== undefined) {
		if (error instanceof Error) {
			ctx.error = {
				name: error.name,
				message: error.message,
				cause: error.cause,
				stack: error.stack,
			};
		} else {
			ctx.error = error;
		}
	}
	logger.error(ctx);
}

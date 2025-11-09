export function toSerializableError(e: unknown): object {
	if (e instanceof Error) {
		return {
			name: e.name,
			msg: e.message,
			stack: e.stack,
		};
	}
	return { thrownValue: e };
}

interface LogData {
	msg: string;
	[key: string]: unknown;
}

function log(level: "debug" | "info" | "warn" | "error", data: LogData) {
	const output = { ...data, level };
	console[level === "info" ? "log" : level](output);
}

export const logger = {
	debug: (data: LogData) => log("debug", data),
	info: (data: LogData) => log("info", data),
	warn: (data: LogData) => log("warn", data),
	error: (data: LogData) => log("error", data),
};

export function logDebug(msg: string, context?: Record<string, unknown>) {
	logger.debug({ msg, ...context });
}

export function logInfo(msg: string, context?: Record<string, unknown>) {
	logger.info({ msg, ...context });
}

export function logWarn(msg: string, context?: Record<string, unknown>) {
	logger.warn({ msg, ...context });
}

export function logError(msg: string, error: unknown, context?: Record<string, unknown>) {
	logger.error({
		msg,
		error: toSerializableError(error),
		...context,
	});
}

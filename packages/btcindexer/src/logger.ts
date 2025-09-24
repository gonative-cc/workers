type LogLevel = "info" | "warn" | "error" | "debug";

type LogContext = Record<string, unknown>;

const log = (level: LogLevel, message: string, context: LogContext = {}) => {
	console.log({
		level,
		message,
		...context,
	});
};

export const logger = {
	info: (message: string, context?: LogContext) => log("info", message, context),
	warn: (message: string, context?: LogContext) => log("warn", message, context),
	error: (message: string, error?: unknown, context?: LogContext) => {
		const errorContext: LogContext = { ...context };
		if (error instanceof Error) {
			errorContext.error = {
				message: error.message,
				stack: error.stack,
				name: error.name,
			};
		} else if (error) {
			errorContext.error = error;
		}
		log("error", message, errorContext);
	},
	debug: (message: string, context?: LogContext) => log("debug", message, context),
};

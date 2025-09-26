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

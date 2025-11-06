export interface Storage {
	markUTXOsLocked(): Promise<void>;
}

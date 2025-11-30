declare module 'node-cache' {
    interface NodeCacheOptions {
        stdTTL?: number;
        checkperiod?: number;
        useClones?: boolean;
    }

    export default class NodeCache {
        constructor(options?: NodeCacheOptions);
        get<T>(key: string): T | undefined;
        set<T>(key: string, value: T, ttl?: number): boolean;
        del(keys: string | string[]): number;
        flushAll(): void;
    }
}


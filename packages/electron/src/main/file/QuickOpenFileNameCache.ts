import { resolve } from 'path';
import { buildQuickOpenCacheForRoot } from './QuickOpenFileScanner';

type CacheItem = Awaited<ReturnType<typeof buildQuickOpenCacheForRoot>>[number];
interface Entry {
    generation: number;
    builtGeneration: number;
    builtAt: number;
    items: CacheItem[];
    pending?: Promise<void>;
}

/** Shared by Quick Open and mentions. Structural events invalidate; searches scan lazily. */
export class QuickOpenFileNameCache {
    private entries = new Map<string, Entry>();

    constructor(private scan = buildQuickOpenCacheForRoot) {}

    invalidate(rootPath: string): void {
        const entry = this.entries.get(resolve(rootPath));
        if (entry) entry.generation++;
    }

    async get(rootPath: string, force = false): Promise<CacheItem[]> {
        const root = resolve(rootPath);
        let entry = this.entries.get(root);
        if (!entry) {
            entry = { generation: 0, builtGeneration: -1, builtAt: 0, items: [] };
            this.entries.set(root, entry);
        }
        // Opening Quick Open explicitly refreshes, but concurrent callers share a scan.
        if (force && !entry.pending) entry.generation++;

        // Retry once if a structural event arrives mid-scan. Under continuous churn,
        // return the latest snapshot but leave it dirty for the next search.
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!entry.pending && entry.builtGeneration === entry.generation &&
                Date.now() - entry.builtAt < 30_000) return entry.items;
            if (!entry.pending) {
                const generation = entry.generation;
                const target = entry;
                target.pending = Promise.resolve().then(() => this.scan(root)).then(items => {
                    target.items = items;
                    target.builtGeneration = generation;
                    target.builtAt = Date.now();
                }).finally(() => { target.pending = undefined; });
            }
            await entry.pending;
            if (entry.builtGeneration === entry.generation) return entry.items;
        }
        return entry.items;
    }
}

// Expiry also repairs missed events and roots searched without an active window watcher.
export const quickOpenFileNameCache = new QuickOpenFileNameCache();

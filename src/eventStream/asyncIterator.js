import {
    EventStreamListener,
    EVENT_STREAM_VOCABULARY
} from "./EventStreamListener.js";

/**
 * createEventAsyncIterable — the pull adapter of the hybrid contract.
 *
 * The push/callback listener is canonical; this wraps a generator run as an
 * async-iterable so ergonomic consumers can `for await (const ev of ...)`.
 * Each yielded event is `{ type, args }` where `type` is a vocabulary method
 * name and `args` is the argument array.
 *
 * Backpressure is real: the bridge installs a drain gate on the listener, so a
 * slow consumer suspends the generator at its checkpoints once the internal
 * queue exceeds `highWaterMark`. Events are freshly allocated (not pooled) so
 * consumers may retain them safely.
 *
 * @param {(listener: EventStreamListener) => Promise<void>} run - drives the listener
 * @param {{ highWaterMark?: number }} [options]
 * @returns {AsyncIterable<{type: string, args: any[]}>}
 */
export function createEventAsyncIterable(run, { highWaterMark = 64 } = {}) {
    return {
        [Symbol.asyncIterator]() {
            const queue = [];
            let finished = false;
            let failure = null;
            let onItem = null; // resolve a waiting consumer
            let onSpace = null; // resolve a suspended producer

            const wakeConsumer = () => {
                if (onItem) {
                    const r = onItem;
                    onItem = null;
                    r();
                }
            };
            const wakeProducer = () => {
                if (onSpace && queue.length < highWaterMark) {
                    const r = onSpace;
                    onSpace = null;
                    r();
                }
            };

            // A capture filter enqueues one event per vocabulary call.
            const captureFilter = {};
            for (const name of EVENT_STREAM_VOCABULARY) {
                captureFilter[name] = function (next, ...args) {
                    queue.push({ type: name, args });
                    wakeConsumer();
                    return next(...args);
                };
            }

            const listener = new EventStreamListener(captureFilter);
            listener.setDrain(() =>
                queue.length < highWaterMark
                    ? Promise.resolve()
                    : new Promise(resolve => {
                          onSpace = resolve;
                      })
            );

            Promise.resolve()
                .then(() => run(listener))
                .then(
                    () => {
                        finished = true;
                        wakeConsumer();
                    },
                    err => {
                        failure = err || new Error("event stream failed");
                        finished = true;
                        wakeConsumer();
                    }
                );

            return {
                async next() {
                    while (queue.length === 0 && !finished) {
                        await new Promise(resolve => {
                            onItem = resolve;
                        });
                    }
                    if (queue.length > 0) {
                        const value = queue.shift();
                        wakeProducer();
                        return { value, done: false };
                    }
                    if (failure) {
                        throw failure;
                    }
                    return { value: undefined, done: true };
                }
            };
        }
    };
}

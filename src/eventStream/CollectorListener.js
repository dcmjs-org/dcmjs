import {
    EventStreamListener,
    mergeFragmentsPerBotWindow
} from "./EventStreamListener.js";

/**
 * CollectorListener — a reference event-stream consumer that rebuilds a
 * tag-keyed `{ meta, dict }` tree from the contract events.
 *
 * Its purpose is to validate the contract: a generator's event stream, fed
 * through this listener, should reconstruct a tree equivalent to the existing
 * dcmjs parse. It is intentionally NOT the naturalized listener (slice D) — it
 * preserves the raw tag-keyed `{ vr, Value }` shape so it can be deep-compared
 * against `DicomMessage.readFile` output.
 *
 * Value shapes match the existing parse:
 *   - scalar/multi-value element → { vr, Value: [...] }
 *   - sequence                   → { vr, Value: [ {itemDict}, ... ] }
 *   - binary                     → { vr, Value: [ArrayBuffer, ...] } (one entry
 *                                   per fragment; boundaries preserved, §33 —
 *                                   except encapsulated pixel data whose
 *                                   startBinary carries a non-empty
 *                                   basicOffsetTable: those fragments are
 *                                   merged per BOT window at endBinary, so the
 *                                   final Value shape matches the eager
 *                                   reader's one-entry-per-frame contract,
 *                                   issue #204)
 *   - bulk data reference        → { vr, Value: [ { BulkDataURI } ] }
 */
export class CollectorListener extends EventStreamListener {
    constructor(...filters) {
        super(...filters);
        this.result = { meta: {}, dict: {} };
        this._stack = [];
        this._current = null;
    }

    /** Top container: an object (dataset/item) or array (sequence Value). */
    _top() {
        return this._stack[this._stack.length - 1];
    }

    _baseStartDataSet() {
        this.result = { meta: {}, dict: {} };
        this._stack = [this.result.dict];
        this._current = null;
    }

    _baseEndDataSet() {
        this._current = null;
    }

    _baseStartFileMetaInformation() {
        this._stack.push(this.result.meta);
    }

    _baseEndFileMetaInformation() {
        this._stack.pop();
    }

    _baseStartElement(tag, info = {}) {
        const el = { vr: info.vr, Value: [] };
        this._top()[tag] = el;
        this._current = el;
    }

    _baseEndElement() {
        this._current = null;
    }

    _baseValue(v) {
        this._current.Value.push(v);
    }

    _baseStartSequence(tag, info = {}) {
        const seq = { vr: info.vr, Value: [] };
        this._top()[tag] = seq;
        this._stack.push(seq.Value);
        this._current = null;
    }

    _baseEndSequence() {
        this._stack.pop();
    }

    _baseStartItem() {
        const item = {};
        this._top().push(item);
        this._stack.push(item);
        this._current = null;
    }

    _baseEndItem() {
        this._stack.pop();
    }

    _baseBulkDataReference(ref = {}) {
        this._current.Value.push({ BulkDataURI: ref.uri });
    }

    _baseStartBinary(info = {}) {
        // The current element accumulates fragments as Value entries. A
        // non-empty basicOffsetTable is kept so endBinary can merge the
        // fragments per BOT window (eager-reader shape parity, issue #204).
        this._binaryInfo = info;
    }

    _baseBinaryFragment(chunk) {
        this._current.Value.push(chunk);
    }

    _baseEndBinary() {
        const bot = this._binaryInfo && this._binaryInfo.basicOffsetTable;
        this._binaryInfo = null;
        if (bot && bot.length && this._current) {
            this._current.Value = mergeFragmentsPerBotWindow(
                this._current.Value,
                bot
            );
        }
    }
}

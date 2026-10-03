/**
 * Workspace wiring smoke test for @dcmjs-org/tests.
 *
 * The real cross-package suites still live in the root test/ tree (see this
 * package's README); this one test exists to prove the package itself is
 * wired into the workspace test run. It imports two sibling packages BY
 * PACKAGE NAME — resolving through the pnpm workspace links declared in this
 * package's dependencies, not through relative source paths — and makes them
 * cooperate: a tag built by @dcmjs-org/core keys a dataset that
 * @dcmjs-org/parser streams through its event contract and collects back.
 */
import { Tag } from "@dcmjs-org/core";
import {
    CollectorListener,
    CONTRACT_VERSION,
    fromDataSet
} from "@dcmjs-org/parser";

it("resolves sibling packages by name and round-trips a dataset through them", async () => {
    // @dcmjs-org/core: build the SOPClassUID tag key the parser-side dict uses.
    const sopClassUID = Tag.fromNumbers(0x0008, 0x0016).toCleanString();
    expect(sopClassUID).toBe("00080016");

    // @dcmjs-org/parser: stream a one-element dataset through the event
    // contract and collect it back.
    const dataset = {
        dict: {
            [sopClassUID]: {
                vr: "UI",
                Value: ["1.2.840.10008.5.1.4.1.1.4"]
            }
        }
    };
    const listener = new CollectorListener();
    await fromDataSet(dataset, listener);

    expect(typeof CONTRACT_VERSION).toBe("string");
    expect(listener.result.dict[sopClassUID].Value).toEqual([
        "1.2.840.10008.5.1.4.1.1.4"
    ]);
});

//
// Exports
//

/**
 * Runs in the page to gather ResourceTiming data from the page and all accessible frames.
 *
 * NOTE: This function is serialized by Puppeteer, so it must be self-contained.
 *
 * @returns {object} ResourceTiming data
 */
export function gatherResourceTimings() {
    /**
     * Determines if the frame is accessible and has the performance object
     *
     * @param {Window} frame Frame
     *
     * @returns {boolean} True if accessible
     */
    function isFrameAccessible(frame) {
        try {
            // accessing location.href / document throws for cross-origin frames
            return Boolean(frame.location.href && frame.document && frame.performance);
        } catch {
            return false;
        }
    }

    /**
     * Crawls the frame
     *
     * @param {Window} frame Frame
     * @param {boolean} isTopWindow If the top window
     * @param {number} depth Frame depth
     *
     * @returns {object[]} ResourceTiming entries
     */
    function crawlFrame(frame, isTopWindow, depth) {
        console.log(`Crawling frame top: ${isTopWindow} depth: ${depth}`);

        const entries = [];

        try {
            if (!isFrameAccessible(frame)) {
                return [];
            }

            console.log(`  url: ${frame.location.href}`);

            for (const childFrame of Array.from(frame.frames ?? [])) {
                entries.push(...crawlFrame(childFrame, false, depth + 1));
            }

            if (typeof frame.performance.getEntriesByType !== "function") {
                return [];
            }

            for (const res of frame.performance.getEntriesByType("resource")) {
                // reduce to what we want in the analyzer
                entries.push({
                    name: res.name,
                    initiatorType: res.initiatorType,
                    transferSize: res.transferSize,
                    decodedBodySize: res.decodedBodySize,
                    noTao: res.responseStart === 0,
                    responseStart: res.responseStart,
                    frameDepth: depth
                });
            }
        } catch {
            // NOP
        }

        return entries;
    }

    const mainFrameEntries = window.performance.getEntriesByType("resource").length;

    return {
        resources: crawlFrame(window, true, 0),
        bufferSize: window.setResourceTimingBufferSize ?? 150,
        clearResourceTimingsCalled: window.clearResourceTimingsCalled ?? false,
        exceededDefaultBuffer: mainFrameEntries >= 150,
        mainFrameEntries
    };
}

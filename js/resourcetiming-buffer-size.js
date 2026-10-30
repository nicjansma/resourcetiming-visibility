//
// Exports
//

/**
 * Runs in the page (before any other script) to make the ResourceTiming buffer
 * 'unlimited' and track calls to setResourceTimingBufferSize() / clearResourceTimings().
 *
 * NOTE: This function is serialized by Puppeteer, so it must be self-contained.
 */
export function trackResourceTimingBuffer() {
    const perf = window.performance;

    // make an 'unlimited' buffer first
    perf.setResourceTimingBufferSize(999999);

    // save any calls to setResourceTimingBufferSize
    const origSetResourceTimingBufferSize = perf.setResourceTimingBufferSize;

    perf.setResourceTimingBufferSize = function(limit) {
        window.setResourceTimingBufferSize = limit;
        origSetResourceTimingBufferSize.call(perf, limit);
    };

    // save any calls to clearResourceTimings
    const origClearResourceTimings = perf.clearResourceTimings;

    perf.clearResourceTimings = function() {
        window.clearResourceTimingsCalled = true;
        origClearResourceTimings.call(perf);
    };
}

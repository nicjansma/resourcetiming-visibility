"use strict";
/* eslint-env browser */
//
// Exports
//
exports.exec = async function() {
    // make an 'unlimited' buffer first
    window.performance.setResourceTimingBufferSize(999999);

    // save any calls to setResourceTimingBufferSize
    (function(_setResourceTimingBufferSize) {
        window.performance.setResourceTimingBufferSize = function(limit) {
            window.setResourceTimingBufferSize = limit;
            _setResourceTimingBufferSize.call(window.performance, limit);
        };
    }(window.performance.setResourceTimingBufferSize));

    // save any calls to clearResourceTimings
    (function(_clearResourceTimings) {
        window.performance.clearResourceTimings = function() {
            window.clearResourceTimingsCalled = true;
            _clearResourceTimings.call(window.performance);
        };
    }(window.performance.clearResourceTimings));
};

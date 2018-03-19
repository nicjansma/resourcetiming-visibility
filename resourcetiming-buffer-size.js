"use strict";
/* eslint-env browser */
//
// Exports
//
exports.exec = async function() {
    // save any calls to setResourceTimingBufferSize
    (function(_setResourceTimingBufferSize) {
        window.performance.setResourceTimingBufferSize = function(limit) {
            window.setResourceTimingBufferSize = limit;
            _setResourceTimingBufferSize.call(window.performance, limit);
        };
    }(window.performance.setResourceTimingBufferSize));
};

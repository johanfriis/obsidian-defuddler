/**
 * Silences one specific noise, and nothing else.
 *
 * Defuddle's YouTube extractor tries to read the player JSON inline, fails, and logs the
 * `SyntaxError` with a full stack trace before falling back to fetching the data. The *failure is
 * expected* — M0/S1 measured that the inline parse never succeeds on a watch page — but it is logged
 * unconditionally at error level, so a green test run is decorated with three red stack traces that
 * look exactly like failures. That is the whole reason to filter it: a run has to be readable at a
 * glance, or a real failure hides in noise nobody reads any more.
 *
 * The match is on the exact message. Every other `console.error` still comes through.
 */
const NOISE = 'YoutubeExtractor: failed to parse inline JSON';
const original = console.error;

console.error = (...args: unknown[]) => {
	if (typeof args[0] === 'string' && args[0].startsWith(NOISE)) return;
	original(...args);
};

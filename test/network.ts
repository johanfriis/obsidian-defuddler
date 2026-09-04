/**
 * Whether the tests that leave this machine should run.
 *
 * Two of them do, and both depend on YouTube's transcript API answering. That is not something a
 * release should be able to fail on: it broke the 1.0.3 build, because YouTube served the runner a
 * transcript for one video and refused it for another. A test that can go red for a reason that is
 * not ours does not belong in the default run, and certainly not in the release path.
 *
 * So they are opt-in. `just test-network` runs them; `npm test` and CI do not.
 *
 * Connectivity is still checked, so an opted-in run on a train skips rather than fails.
 */
export const runNetworkTests =
	process.env.DEFUDDLER_NETWORK_TESTS === '1' &&
	(await fetch('https://www.youtube.com/generate_204', { signal: AbortSignal.timeout(4000) })
		.then(() => true)
		.catch(() => false));

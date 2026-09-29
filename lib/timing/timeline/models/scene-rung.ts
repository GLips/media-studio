// scene-rung.ts: how far a scene is from finished. Every scene starts blocked, its own pieces as simple shapes moving
// on its cues at the real timing, and rises in place to final, so one composition is the animatic and the finished
// cut. Its binding declares the rung, and the render's snapshot carries it for studio review, whose scrubber,
// storyboard and notes name it.

/**
 * - `blocking`: the scene's pieces placed and moving on its cues, unstyled: `blockingScene` for a flat scene, a 3D
 *   blockout (`Blockout`) where a camera moves through space.
 * - `final`: the finished picture.
 */
export type SceneRung = 'blocking' | 'final';

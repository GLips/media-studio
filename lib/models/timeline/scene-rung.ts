// scene-rung.ts: how far up the fidelity ladder (skills/video-kickoff) a scene is. A scene starts low and rises in
// place, so one composition is the animatic, the blocking and the finished cut; its binding declares the rung, and the
// render's snapshot carries it for studio review and studio storyboard.

/**
 * - `card`: a title card, the scene's id, note and cues on a plain ground (TitleCard).
 * - `board`: one held image, a sketch or style frame, with at most one push or slide and a caption (BoardFrame).
 * - `blocking`: the scene's own pieces placed and moving on its cues, not yet finished.
 * - `final`: the finished picture.
 */
export type SceneRung = 'card' | 'board' | 'blocking' | 'final';

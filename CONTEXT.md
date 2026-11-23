# media-studio

Where Graham's agents plan, make and render videos, and where he reviews them.

## Language

**Footage**:
Any moving-picture material a video can use, whatever made it: a recording, generated clips, previs, third-party clips.
_Avoid_: Clip (for the source material), asset.

**Recording**:
The footage from one press of the record key to the next: screen, camera, mic and an input log, each its own track on one clock.
_Avoid_: Capture (that's a scripted site capture), demo, session.

**Library**:
The one store of footage that any project can draw on, with each item's transcript and flags.
_Avoid_: Pool, bin.

**Take**:
One attempt at the same material, in the everyday video sense: a recording may hold several takes of a point, and a voice line has takes.

**Capture**:
A scripted recording of a website, driven by a project's `capture.ts`.

**Pickup**:
A short recording the producer asks for to make a story work, such as a bridging sentence or a hook.
_Avoid_: Reshoot, insert.

**Input log**:
The timed mouse moves, clicks with positions, and key presses during a recording or a capture.

**Flag**:
A marked range on a library item, with an optional note, set by Graham or an agent.

## Relationships

- A **Recording** is one item of **Footage** in the **Library**, and may contain many **Takes**.
- A project references **Library** footage by item and time range; it never holds a copy.
- A **Recording** and a **Capture** each carry an **Input log** of the same shape.

## Flagged ambiguities

- "capture" was proposed for a recording; resolved: **Capture** stays the scripted site capture, and the hotkey's output is a **Recording**.
- "footage" in code meant only previs-generated clips (`@footage`, `PrevisFootage`); resolved: **Footage** is the general term, and previs keeps a previs-specific name.

// library-errors.ts: every failure the library expects, each a tagged error whose message is the one line the CLI
// prints. Pure, so a model refuses with the same error an engine does. A failure not listed here (a file system
// error, ffmpeg or whisper failing) is the service's own and reaches the CLI as that service words it.
import { Schema } from 'effect';

/** A request the library refuses as asked: a value the CLI can't read, tracks named wrong, a path that isn't there. */
export class LibraryRequestRefused extends Schema.TaggedError<LibraryRequestRefused>()('LibraryRequestRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** No item has this id: read by its whole id, which only a stale caller misses. */
export class LibraryItemMissing extends Schema.TaggedError<LibraryItemMissing>()('LibraryItemMissing', {
  id: Schema.String,
}) {
  override get message(): string {
    return `there's no library item ${this.id}: \`studio library list\` lists them`;
  }
}

/** No item's id holds what the caller named. */
export class LibraryItemUnknown extends Schema.TaggedError<LibraryItemUnknown>()('LibraryItemUnknown', {
  named: Schema.String,
  libraryEmpty: Schema.Boolean,
}) {
  override get message(): string {
    return `there's no library item ${this.named}${this.libraryEmpty ? ': the library is empty' : ''}`;
  }
}

/** Several items' ids hold what the caller named. */
export class LibraryItemAmbiguous extends Schema.TaggedError<LibraryItemAmbiguous>()('LibraryItemAmbiguous', {
  named: Schema.String,
  ids: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `"${this.named}" names ${this.ids.length} items: ${this.ids.join(', ')}`;
  }
}

/** A committed metadata file (item.json, transcript.json, flags.json) isn't one this studio reads. */
export class LibraryFileUnreadable extends Schema.TaggedError<LibraryFileUnreadable>()('LibraryFileUnreadable', {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.path} ${this.reason}`;
  }
}

/** The footage an add names is an item already. */
export class LibraryFootageAlreadyAdded extends Schema.TaggedError<LibraryFootageAlreadyAdded>()('LibraryFootageAlreadyAdded', {
  source: Schema.String,
  id: Schema.String,
}) {
  override get message(): string {
    return `${this.source} is in the library already, as ${this.id}`;
  }
}

/** The take's recorder is still writing it. `named` is the folder as the caller named it. */
export class LibraryTakeStillRecording extends Schema.TaggedError<LibraryTakeStillRecording>()('LibraryTakeStillRecording', {
  named: Schema.String,
}) {
  override get message(): string {
    return `${this.named} is still recording: add it once it stops`;
  }
}

/** A take every one of whose tracks was left out, each with why. */
export class LibraryNoTrackToAdd extends Schema.TaggedError<LibraryNoTrackToAdd>()('LibraryNoTrackToAdd', {
  folder: Schema.String,
  leftOut: Schema.Record(Schema.String, Schema.String),
}) {
  override get message(): string {
    return `${this.folder} holds no track to add: ${Object.entries(this.leftOut).map(([track, why]) => `${track}, ${why}`).join('; ')}`;
  }
}

/** A track's file holds nothing the library can take: no stream ffmpeg reads, or no length. */
export class LibraryTrackUnreadable extends Schema.TaggedError<LibraryTrackUnreadable>()('LibraryTrackUnreadable', {
  path: Schema.String,
  lacks: Schema.Literals(['streams', 'length']),
}) {
  override get message(): string {
    return this.lacks === 'streams' ? `${this.path} has no video or sound ffmpeg can read` : `${this.path} has no length ffprobe can read`;
  }
}

/** A change the flags refuse: a range off the item, an unknown flag. Nothing is written. */
export class LibraryFlagRefused extends Schema.TaggedError<LibraryFlagRefused>()('LibraryFlagRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** Another process held an item's flags past the wait for their lock, so nothing was changed. `why` is the lock's own account. */
export class LibraryFlagsLocked extends Schema.TaggedError<LibraryFlagsLocked>()('LibraryFlagsLocked', {
  path: Schema.String,
  why: Schema.String,
}) {
  override get message(): string {
    return `${this.why}: no flag was changed, so try again once it lets go`;
  }
}

/** ffmpeg's loudness pass over an item's speech failed, so it can't be levelled. */
export class LibrarySpeechUnmeasured extends Schema.TaggedError<LibrarySpeechUnmeasured>()('LibrarySpeechUnmeasured', {
  id: Schema.String,
  track: Schema.String,
  why: Schema.String,
}) {
  override get message(): string {
    return `ffmpeg couldn't measure ${this.id}'s ${this.track}: ${this.why}`;
  }
}

/** Projects use the item a remove names, so it stays: removing it would break their scenes. */
export class LibraryItemInUse extends Schema.TaggedError<LibraryItemInUse>()('LibraryItemInUse', {
  id: Schema.String,
  projects: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `${this.id} is used by ${this.projects.join(', ')}: it stays until they stop using it`;
  }
}

/** A contact sheet of a track couldn't be drawn from its frames: `reason` says how. */
export class LibrarySheetFailed extends Schema.TaggedError<LibrarySheetFailed>()('LibrarySheetFailed', {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `couldn't draw ${this.path}: ${this.reason}`;
  }
}

/** library-grade.py failed: couldn't start, found no person to measure, or its decoder or encoder failed. */
export class LibraryGradeFailed extends Schema.TaggedError<LibraryGradeFailed>()('LibraryGradeFailed', {
  id: Schema.String,
  step: Schema.Literals(['measure', 'grade', 'still']),
  why: Schema.String,
}) {
  override get message(): string {
    return `grading ${this.id} failed to ${this.step}: ${this.why}`;
  }
}

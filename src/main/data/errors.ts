/**
 * Errors the data layer reports. Messages are written for the game master;
 * `code` lets the interface choose what to offer (for example "Restore the
 * latest backup").
 */

export type LibraryErrorCode =
  /** The file is damaged or is not a library at all. */
  | "corrupt"
  /** The library was saved by a newer version of Lyre than this one. */
  | "newer-version"
  /** An automatic upgrade of the library failed and was rolled back. */
  | "upgrade-failed"
  /** A backup could not be written or checked. */
  | "backup-failed";

export class LibraryDatabaseError extends Error {
  readonly code: LibraryErrorCode;
  /** The newest good backup, when one exists (offered after "corrupt"). */
  readonly latestBackup: string | null;
  /** The underlying SQLite or file-system error, for the log. */
  readonly cause: unknown;

  constructor(code: LibraryErrorCode, message: string, options: { cause?: unknown; latestBackup?: string | null } = {}) {
    super(message);
    this.cause = options.cause;
    this.name = "LibraryDatabaseError";
    this.code = code;
    this.latestBackup = options.latestBackup ?? null;
  }
}

/** A value passed to the data layer that it cannot accept. */
export class ValidationError extends Error {
  /** The input field at fault, for example "title". */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** The row asked for does not exist (any more). */
export class NotFoundError extends Error {
  readonly entity: string;
  readonly id: string;

  constructor(entity: string, id: string) {
    super(`No ${entity} with id "${id}".`);
    this.name = "NotFoundError";
    this.entity = entity;
    this.id = id;
  }
}

/** A write the library refuses, in plain words for the game master (libraryApi.ts turns it into a refusal). */
import type { RefusalCode } from "../../common/lyre/api";

export class Refused extends Error {
  readonly code: RefusalCode;
  readonly field?: string;

  constructor(code: RefusalCode, message: string, field?: string) {
    super(message);
    // The app's bundles compile classes to ES5, where a subclass of Error loses its prototype (errorsBuilt.test.ts).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "Refused";
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

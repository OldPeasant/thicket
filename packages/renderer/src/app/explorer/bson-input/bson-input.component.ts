import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { BINARY_SUBTYPE_UUID, uuidOf } from '@thicket/core/bson';

import { BsonLeaf, type BsonLeafValue, badgeColorVar, badgeOf } from '../bson-value.util';
import {
  type Parsed,
  REGEX_OPTIONS,
  dateToWallTime,
  editText,
  generateObjectId,
  parseBinary,
  parseDate,
  parseDecimal,
  parseDouble,
  parseInt32,
  parseInt64,
  parseObjectId,
  parseRegex,
  parseTimestamp,
  parseUuid,
  wallTimeToMs,
} from '../bson-input.util';
import { BsonDisplayService } from '../services/bson-display.service';

/** Which part of a value an input edits. */
export type Part = 'text' | 'subtype' | 'pattern' | 'options' | 't' | 'i';

/**
 * Typed input for one BSON value (everything but strings, booleans, null,
 * documents and arrays). What is typed is parsed as exactly the value's type:
 * an Int64 stays Int64, a number outside the type's range or an invalid
 * ObjectId shows an error and is not applied. Changes apply on Enter or when
 * the input loses focus; Escape restores the current value.
 */
@Component({
  selector: 'app-bson-input',
  standalone: true,
  templateUrl: './bson-input.component.html',
  styleUrl: './bson-input.component.css',
})
export class BsonInputComponent {
  @Input({ required: true }) value!: BsonLeafValue;
  @Output() valueChange = new EventEmitter<BsonLeafValue>();

  private display = inject(BsonDisplayService);

  /** The last input's problem, shown until the next valid change or Escape. */
  error = '';

  readonly regexOptions = REGEX_OPTIONS;

  get color(): string {
    return badgeColorVar(this.value.type);
  }

  /** UUID binaries are edited as UUID text, other binaries as subtype + base64. */
  get isUuid(): boolean {
    return (
      this.value.type === 'binary' &&
      this.value.subtype === BINARY_SUBTYPE_UUID &&
      uuidOf(this.value) !== null
    );
  }

  get text(): string {
    return editText(this.value, this.display.dates());
  }

  get wallTime(): string {
    return this.value.type === 'date' ? dateToWallTime(this.value.ms, this.display.dates()) : '';
  }

  get utc(): boolean {
    return this.display.utc();
  }

  get subtype(): string {
    return this.value.type === 'binary' ? String(this.value.subtype) : '';
  }

  get pattern(): string {
    return this.value.type === 'regex' ? this.value.pattern : '';
  }

  get options(): string {
    return this.value.type === 'regex' ? this.value.options : '';
  }

  get seconds(): string {
    return this.value.type === 'timestamp' ? String(this.value.t) : '';
  }

  get increment(): string {
    return this.value.type === 'timestamp' ? String(this.value.i) : '';
  }

  get numeric(): boolean {
    return this.value.type === 'int' || this.value.type === 'long' || this.value.type === 'double';
  }

  get wide(): boolean {
    return (
      this.value.type === 'objectId' || this.value.type === 'date' || this.value.type === 'decimal'
    );
  }

  get label(): string {
    return `${badgeOf(new BsonLeaf(this.value)).label} value`;
  }

  get placeholder(): string {
    switch (this.value.type) {
      case 'objectId':
        return '24 hex characters';
      case 'date':
        return 'ISO-8601';
      case 'int':
        return 'Int32';
      case 'long':
        return 'Int64';
      default:
        return '';
    }
  }

  /** Parses what an input holds now (the other parts come from the current value). */
  parse(part: Part, text: string): Parsed {
    const v = this.value;
    switch (v.type) {
      case 'int':
        return parseInt32(text);
      case 'long':
        return parseInt64(text);
      case 'double':
        return parseDouble(text);
      case 'decimal':
        return parseDecimal(text);
      case 'objectId':
        return parseObjectId(text);
      case 'date':
        return parseDate(text, this.display.dates());
      case 'javascript':
        return { ok: true, value: { type: 'javascript', code: text } };
      case 'binary':
        if (this.isUuid) return parseUuid(text);
        return part === 'subtype'
          ? parseBinary(text, v.base64)
          : parseBinary(String(v.subtype), text);
      case 'regex':
        return part === 'options' ? parseRegex(v.pattern, text) : parseRegex(text, v.options);
      case 'timestamp':
        return part === 'i' ? parseTimestamp(String(v.t), text) : parseTimestamp(text, String(v.i));
      default:
        return { ok: false, error: 'this type has no value to edit' };
    }
  }

  /**
   * Applies an input's text: emits the parsed value when it differs, else
   * shows the error (the text stays, to be corrected). An unchanged value
   * written differently ("007" for 7) shows the canonical text again.
   */
  commit(part: Part, input: HTMLInputElement): void {
    const parsed = this.parse(part, input.value);
    if (!parsed.ok) {
      this.error = parsed.error;
      return;
    }
    this.error = '';
    if (!sameValue(parsed.value, this.value)) this.valueChange.emit(parsed.value);
    else input.value = this.partText(part);
  }

  /** Escape: back to the current value. */
  revert(input: HTMLInputElement, part: Part): void {
    this.error = '';
    input.value = this.partText(part);
    input.blur();
  }

  /** The date-time picker's value is wall time in the zone dates are shown in. */
  commitWallTime(wall: string): void {
    if (wall === '') return;
    const ms = wallTimeToMs(wall, this.display.dates());
    if (ms === null) {
      this.error = `"${wall}" is not a valid date`;
      return;
    }
    this.error = '';
    if (this.value.type !== 'date' || ms !== this.value.ms)
      this.valueChange.emit({ type: 'date', ms });
  }

  generate(): void {
    this.error = '';
    this.valueChange.emit(generateObjectId());
  }

  private partText(part: Part): string {
    switch (part) {
      case 'subtype':
        return this.subtype;
      case 'pattern':
        return this.pattern;
      case 'options':
        return this.options;
      case 't':
        return this.seconds;
      case 'i':
        return this.increment;
      default:
        return this.text;
    }
  }
}

function sameValue(a: BsonLeafValue, b: BsonLeafValue): boolean {
  if (a.type !== b.type) return false;
  const keys = Object.keys(a) as (keyof BsonLeafValue)[];
  return keys.every((k) => Object.is(a[k], b[k]));
}

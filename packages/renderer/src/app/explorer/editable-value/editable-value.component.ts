import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import {
  type Badge,
  BsonLeaf,
  type BsonLeafValue,
  badgeColorVar,
  badgeOf,
  isBsonLeaf,
  isDeprecatedValue,
} from '../bson-value.util';
import {
  type CreatableTarget,
  type TypeOption,
  convertValue,
  currentTarget,
  typeOptions,
} from '../bson-input.util';
import { BsonInputComponent } from '../bson-input/bson-input.component';
import { type JsonType, typeOf } from '../json-edit.util';
import { NumberDefaultService } from '../services/number-default.service';
import { BsonDisplayService } from '../services/bson-display.service';
import { HighlightComponent } from '../highlight/highlight.component';
import { EditModeService } from '../services/edit-mode.service';
import { SchemaService } from '../services/schema.service';

@Component({
  selector: 'app-editable-value',
  standalone: true,
  imports: [HighlightComponent, BsonInputComponent],
  templateUrl: './editable-value.component.html',
  styleUrl: './editable-value.component.css',
})
export class EditableValueComponent {
  @Input({ required: true }) value: unknown;
  // Instance key of the node this value belongs to; how the schema is asked about it.
  @Input() uid = '';
  // Shown as plain text even in edit mode (e.g. inside a partly loaded array).
  @Input() readOnly = false;
  @Output() valueChange = new EventEmitter<unknown>();

  protected editMode = inject(EditModeService);
  private schema = inject(SchemaService);
  private display = inject(BsonDisplayService);
  private numbers = inject(NumberDefaultService);

  get badge(): Badge {
    return badgeOf(this.value);
  }

  // The document root needs no badge: it is what the whole view shows.
  get showBadge(): boolean {
    return this.uid !== '' || (this.type !== 'object' && this.type !== 'array');
  }

  get badgeColor(): string {
    return badgeColorVar(this.badge.type);
  }

  // A deprecated BSON type (Undefined, Symbol, DBPointer, Code with scope)
  // is kept as it is: never edited, not even in edit mode.
  get deprecated(): boolean {
    return isDeprecatedValue(this.value);
  }

  // The exact text of a BSON value (Int64, Decimal128, Date in the zone shown…).
  get bsonText(): string {
    return this.display.text(this.value);
  }

  // Read-only per the schema (or the `readOnly` input): shown as plain text even in edit mode.
  get locked(): boolean {
    return this.editMode.enabled() && (this.readOnly || this.schema.readOnlyFor(this.uid));
  }

  get type(): JsonType {
    return typeOf(this.value);
  }

  // The values the schema allows here, when it lists them all: shown as a
  // dropdown instead of a free-form input.
  get choices(): readonly (string | number | boolean | null)[] | undefined {
    return this.schema.choicesFor(this.uid);
  }

  // Index of the current value among the choices, or -1 if it isn't one.
  get choiceIndex(): number {
    const now = JSON.stringify(this.value);
    return this.choices?.findIndex((c) => JSON.stringify(c) === now) ?? -1;
  }

  choiceLabel(value: unknown): string {
    return value === '' ? '""' : typeof value === 'string' ? value : JSON.stringify(value);
  }

  // The BSON value a typed input edits (everything but strings, booleans,
  // null, documents and arrays).
  get leaf(): BsonLeafValue | undefined {
    return isBsonLeaf(this.value) ? this.value.bson : undefined;
  }

  // The dropdown entry the value is now ('uuid' for a UUID binary).
  get current(): string {
    return currentTarget(this.value);
  }

  // What the type dropdown offers: every creatable BSON type, those the value
  // can't be converted to (bson-model's table) disabled with the reason. With
  // a schema, only the types it allows, plus the current one so the dropdown
  // can always show what is there now. With a single option there is
  // nothing to choose, so the dropdown is hidden. Computed once per value
  // (and schema type list), not on every change detection.
  get typeOptions(): TypeOption[] {
    const allowed = this.schema.typesFor(this.uid) as readonly string[] | undefined;
    const memo = this.optionsMemo;
    if (memo && Object.is(memo.value, this.value) && memo.allowed === allowed) return memo.options;
    const current = this.current;
    const all = typeOptions(this.value);
    const options = allowed
      ? all.filter(
          (o) => o.target === current || jsonTypesOf(o.target).some((t) => allowed.includes(t)),
        )
      : all;
    this.optionsMemo = { value: this.value, allowed, options };
    return options;
  }

  private optionsMemo?: {
    value: unknown;
    allowed: readonly string[] | undefined;
    options: TypeOption[];
  };

  onChoice(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const index = Number(select.value);
    const choices = this.choices;
    if (choices && index >= 0 && index !== this.choiceIndex) this.valueChange.emit(choices[index]);
    // A parent may decline the change (a variant switch waiting for
    // confirmation); the dropdown must then show the value that is really
    // there. If the change was applied, the option bindings move it right after.
    setTimeout(() => (select.value = String(this.choiceIndex)));
  }

  onTypeChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const target = select.value as CreatableTarget;
    if (target !== this.current) {
      let next: unknown;
      try {
        next = convertValue(this.value, target);
      } catch {
        next = undefined; // disabled options can't be chosen; a stale one is ignored
      }
      if (next !== undefined) this.valueChange.emit(next);
    }
    // As in onChoice: show what is really there once the change landed (or not).
    setTimeout(() => (select.value = this.current));
  }

  commitBson(v: BsonLeafValue): void {
    this.valueChange.emit(new BsonLeaf(v));
  }
  commitString(v: string): void {
    if (v === this.value) return;
    this.valueChange.emit(v);
  }

  // A plain number (from a schema default or seed) becomes a BSON number of
  // the type the settings give new numbers (Int32 or Double by default).
  commitNumber(v: string): void {
    const n = v.trim() === '' ? 0 : Number(v);
    const next = Number.isNaN(n) ? 0 : n;
    if (next === this.value) return;
    this.valueChange.emit(new BsonLeaf(this.numbers.newNumber(next)));
  }

  commitBoolean(checked: boolean): void {
    this.valueChange.emit(checked);
  }
}

// The JSON Schema types a BSON type counts as (for a schema's `type` list).
function jsonTypesOf(target: CreatableTarget): readonly string[] {
  switch (target) {
    case 'string':
      return ['string'];
    case 'bool':
      return ['boolean'];
    case 'null':
      return ['null'];
    case 'object':
      return ['object'];
    case 'array':
      return ['array'];
    case 'int':
    case 'long':
      return ['integer', 'number'];
    case 'double':
    case 'decimal':
      return ['number'];
    default:
      return [];
  }
}

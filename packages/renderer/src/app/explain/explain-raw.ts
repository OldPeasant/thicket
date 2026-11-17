import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { parseEJson } from '@thicket/core/bson';

import { toExplorerValue } from '../explorer/bson-value.util';
import { JsonExplorerComponent } from '../explorer/json-explorer.component';
import { BsonDisplayService } from '../explorer/services/bson-display.service';
import { CollapseService } from '../explorer/services/collapse.service';
import { ColumnSyncService } from '../explorer/services/column-sync.service';
import { EditModeService } from '../explorer/services/edit-mode.service';
import { FilterService } from '../explorer/services/filter.service';
import { FocusService } from '../explorer/services/focus.service';
import { JsonLinesService } from '../explorer/services/json-lines.service';
import { JumpService } from '../explorer/services/jump.service';
import { LayoutService } from '../explorer/services/layout.service';
import { NodeVisibilityService } from '../explorer/services/node-visibility.service';
import { PageService } from '../explorer/services/page.service';
import { PanelService } from '../explorer/services/panel.service';
import { SchemaService } from '../explorer/services/schema.service';
import { TableOrientationService } from '../explorer/services/table-orientation.service';

/**
 * The raw explain output in the document viewer (the explorer, read-only). It has its own explorer
 * state, so searching or collapsing in it leaves the host tab's documents alone.
 */
@Component({
  selector: 'app-explain-raw',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonExplorerComponent],
  providers: [
    BsonDisplayService,
    CollapseService,
    ColumnSyncService,
    EditModeService,
    FilterService,
    FocusService,
    JsonLinesService,
    JumpService,
    LayoutService,
    NodeVisibilityService,
    PanelService,
    PageService,
    SchemaService,
    TableOrientationService,
  ],
  template: `
    @let v = value();
    @if (v.ok) {
      <app-json-explorer [value]="v.value" layout="form" />
    } @else {
      <p class="unreadable" data-testid="explain-raw-error">
        The output can't be read as EJSON ({{ v.message }}); its text:
      </p>
      <pre class="text">{{ explain() }}</pre>
    }
  `,
  styles: `
    .unreadable {
      margin: 0.5rem 0;
      color: var(--text-muted);
    }
    .text {
      margin: 0;
      font-family: var(--font-mono);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class ExplainRaw {
  /** The explain output as canonical EJSON text. */
  readonly explain = input.required<string>();

  /** The output for the explorer; text that doesn't parse is shown as it is instead. */
  protected readonly value = computed(() => {
    try {
      return { ok: true as const, value: toExplorerValue(parseEJson(this.explain())) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

  constructor() {
    inject(EditModeService).setReadOnly(true);
  }
}

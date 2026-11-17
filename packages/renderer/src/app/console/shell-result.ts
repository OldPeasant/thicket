import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { JsonExplorerComponent } from '../explorer/json-explorer.component';
import { ArraySliceService } from '../explorer/services/array-slice.service';
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
 * One shell result in the Thicket viewer: the explorer, read-only, with its own services, so
 * search, collapse and columns belong to this result only.
 */
@Component({
  selector: 'app-shell-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonExplorerComponent],
  providers: [
    ArraySliceService,
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
  template: `<app-json-explorer [value]="tree()" layout="tables" />`,
  styles: `
    :host {
      display: block;
      max-height: 32rem;
      overflow: auto;
    }
  `,
})
export class ShellResult {
  /** The explorer tree of the result (`toExplorerValue`). */
  readonly tree = input.required<unknown>();

  constructor() {
    inject(EditModeService).setReadOnly(true);
  }
}

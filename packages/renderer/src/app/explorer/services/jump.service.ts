import { Injectable, inject } from '@angular/core';
import { pathKey, type Path, type Problem } from '../../schema';
import { formPageKey } from '../page.util';
import { formFields } from '../form-fields.util';
import { groupRootPath, lineUid } from '../json-lines.util';
import { revealSteps, type RevealStep } from '../jump-steps.util';
import { CollapseService } from './collapse.service';
import { FilterService } from './filter.service';
import { FocusService } from './focus.service';
import { JsonLinesService, LINES_PAGE_KEY, LINES_PAGE_SIZE } from './json-lines.service';
import { LayoutService } from './layout.service';
import { NestedPageSizeService } from './nested-page-size.service';
import { NodeVisibilityService } from './node-visibility.service';
import { PageService } from './page.service';
import { SchemaService } from './schema.service';

// Takes the user to the node a schema problem is shown on: undoes whatever
// hides it — an active search, a collapsed ancestor, a hidden column, rows
// on another page — then scrolls to it and flashes it.
@Injectable({ providedIn: 'root' })
export class JumpService {
  private collapse = inject(CollapseService);
  private pages = inject(PageService);
  private pageSize = inject(NestedPageSizeService);
  private visibility = inject(NodeVisibilityService);
  private filter = inject(FilterService);
  private schema = inject(SchemaService);
  private layout = inject(LayoutService);
  private focus = inject(FocusService);
  private lines = inject(JsonLinesService);

  to(problem: Problem, data: unknown): void {
    this.toPath(this.schema.index().anchorOf(problem), data);
  }

  // Shows the node at `anchor` and scrolls to it: what the problem list does
  // for a problem, and the outline for a group.
  toPath(anchor: Path, data: unknown): void {
    // A search would keep hiding the node. Clearing it also drops every
    // collapse choice, so it has to come before the ancestors are expanded.
    if (this.filter.active) this.filter.clear();
    // The form lays out an object by schema order, ghosts included, so it
    // paginates by that; but only down to the first array, which hands
    // everything below it to the table.
    let inTable = false;
    for (const step of this.stepsTo(anchor, data)) {
      if (this.collapse.get(step.uid, step.path) === true)
        this.collapse.set(step.uid, step.path, false, false);
      if (step.colKey && this.visibility.isHidden(step.colKey)) this.visibility.toggle(step.colKey);
      const byForm = this.layout.mode() === 'form' && !inTable && step.kind === 'object';
      const fields = byForm ? this.formFieldsOf(step) : undefined;
      const position = fields
        ? Math.max(
            0,
            fields.findIndex((f) => f.key === step.key),
          )
        : step.position;
      this.pages.ensure(byForm ? formPageKey(step.uid) : step.uid, position, this.pageSize.size());
      if (step.kind !== 'object') inTable = true;
    }
    this.focus.set(pathKey(anchor));
    this.focusWhenRendered(pathKey(anchor));
  }

  // For JSON Lines the first step of a path is the line: page the list of
  // lines as far as that one, then go on inside it.
  private stepsTo(anchor: Path, data: unknown): RevealStep[] {
    const doc = this.lines.doc();
    if (!doc) return revealSteps(data, anchor);
    const index = anchor[0] as number;
    const line = doc.lines[index];
    this.pages.ensure(
      LINES_PAGE_KEY,
      Math.max(0, this.lines.shown().indexOf(index)),
      LINES_PAGE_SIZE,
    );
    if (line?.kind !== 'json') return [];
    return revealSteps(line.value, anchor.slice(1), {
      uid: lineUid(index),
      path: groupRootPath(line.group),
    });
  }

  private formFieldsOf(step: RevealStep) {
    return formFields(
      step.container as Record<string, unknown>,
      this.schema.declaredKeys(step.uid),
      this.schema.ghostsFor(step.uid),
      this.schema.requiredFor(step.uid),
    );
  }

  // The node renders after the state changes above, so look for its marker
  // for a moment rather than once.
  private focusWhenRendered(key: string, attempt = 0): void {
    // The form marks every field (data-node); a problem badge marks its node in either layout.
    const escaped = CSS.escape(key);
    const marker =
      document.querySelector(`[data-node="${escaped}"]`) ??
      document.querySelector(`[data-problem-key="${escaped}"]`);
    if (marker) {
      const target = marker.closest('td, th, .field') ?? marker;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      target.classList.remove('jump-flash');
      void (target as HTMLElement).offsetWidth; // restart the animation if it is already running
      target.classList.add('jump-flash');
      setTimeout(() => target.classList.remove('jump-flash'), 1600);
    } else if (attempt < 20) {
      setTimeout(() => this.focusWhenRendered(key, attempt + 1), 50);
    }
  }
}

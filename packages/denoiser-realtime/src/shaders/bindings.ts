// Generated-pass helper: WGSL binding declarations and the matching layout
// entries come from one list, so the host can never bind in a different order.
import type { EntryKind } from '../gpu';

/** A generated pass: WGSL plus its bindings in order (layout kind + resource name). */
export interface PassDef {
  code: string;
  entries: { name: string; kind: EntryKind }[];
}

export class Bindings {
  readonly entries: { name: string; kind: EntryKind }[] = [];
  private decls: string[] = [];
  /** A texture / sampler / storage binding: `name: type`. */
  add(name: string, type: string, kind: EntryKind) {
    this.decls.push(`@group(0) @binding(${this.entries.length}) var ${name}: ${type};`);
    this.entries.push({ name, kind });
    return this;
  }
  /** A uniform buffer binding of struct type `struct`. */
  uniform(name: string, struct: string) {
    this.decls.push(`@group(0) @binding(${this.entries.length}) var<uniform> ${name}: ${struct};`);
    this.entries.push({ name, kind: 'u' });
    return this;
  }
  get wgsl() { return this.decls.join('\n'); }
}


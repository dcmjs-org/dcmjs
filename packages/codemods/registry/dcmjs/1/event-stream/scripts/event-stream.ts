import type { Codemod, Edit, SgNode } from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import { useMetricAtom } from 'codemod:metrics';

type Node = SgNode<TSX>;

/** Sites that the codemod did not change. A person must change them. */
const manual = useMetricAtom('dcmjs-1-manual');

/** Sites where the event stream gives a different value. A person must decide. */
const review = useMetricAtom('dcmjs-1-review');

const SUBPATH = '@dcmjs-org/dcmjs/eventStream';

/** The readFile options that the event stream accepts with the same meaning. */
const READ_OPTIONS = new Set(['ignoreErrors', 'forceStoreRaw', 'allowMissingHeader']);

const FUNCTIONS = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
]);

function site(root, rule: string, node: Node) {
  return {
    rule,
    file: root.relativeFilename?.() || root.filename(),
    line: String(node.range().start.line + 1),
  };
}

function calls(node: Node | null | undefined, name: string): boolean {
  if (node?.kind() !== 'call_expression') return false;
  const callee = node.field('function')?.text() ?? '';
  return callee === name || callee.endsWith(`.${name}`);
}

function argumentsOf(call: Node): Node[] {
  return call.field('arguments')?.children().filter((child) => child.isNamed()) ?? [];
}

/** The reason why `readFile(buffer, options)` cannot move, or null. */
function optionsProblem(options: Node | undefined): string | null {
  if (!options) return null;
  if (options.kind() !== 'object') return 'the options are not an object literal';
  for (const pair of options.children().filter((child) => child.isNamed())) {
    const key = pair.kind() === 'pair' ? pair.field('key')?.text() : pair.text();
    if (!READ_OPTIONS.has(key ?? '')) return `the option ${key} has no event stream form`;
  }
  return null;
}

/** True when `await` is permitted where the node is. */
function canAwait(node: Node, esm: boolean): boolean {
  const fn = node.ancestors().find((ancestor) => FUNCTIONS.has(ancestor.kind()));
  if (!fn) return esm;
  return fn.children().some((child) => child.kind() === 'async');
}

/** The statement whose parent is a block or the program. */
function statementOf(node: Node): Node | null {
  for (const candidate of [node, ...node.ancestors()]) {
    const kind = candidate.parent()?.kind();
    if (kind === 'program' || kind === 'statement_block') return candidate;
  }
  return null;
}

/** `const name = value;` with one declarator: { name, value }. */
function declaration(statement: Node | null) {
  if (statement?.kind() !== 'lexical_declaration' && statement?.kind() !== 'variable_declaration') {
    return null;
  }
  const declarators = statement.children().filter((child) => child.kind() === 'variable_declarator');
  if (declarators.length !== 1) return null;
  const name = declarators[0].field('name');
  const value = declarators[0].field('value');
  if (name?.kind() !== 'identifier' || !value) return null;
  return { keyword: statement.child(0)?.text() ?? 'const', name: name.text(), value };
}

/** The number of times an identifier appears in the function or the file. */
function uses(scope: Node, name: string): number {
  return scope.findAll({ rule: { kind: 'identifier', regex: `^${name}$` } }).length;
}

function scopeOf(node: Node): Node {
  return node.ancestors().find((ancestor) => FUNCTIONS.has(ancestor.kind())) ?? node.getRoot().root();
}

/** `naturalizeDataset(<dict>.<field>)`: the dict expression, or null. */
function naturalizedField(node: Node | null | undefined, field: 'dict' | 'meta') {
  if (!calls(node, 'naturalizeDataset')) return null;
  const [argument] = argumentsOf(node!);
  if (argument?.kind() !== 'member_expression') return null;
  if (argument.field('property')?.text() !== field) return null;
  return argument.field('object');
}

/** `denaturalizeDataset(x)`: the text of x, or null. */
function denaturalized(node: Node | null | undefined): string | null {
  if (!calls(node, 'denaturalizeDataset')) return null;
  const [argument] = argumentsOf(node!);
  return argument ? argument.text() : null;
}

const codemod: Codemod<TSX> = (root) => {
  const rootNode = root.root();
  const text = rootNode.text();
  if (!/DicomMessage|DicomDict/.test(text)) return null;

  const esm = rootNode.children().some((child) => child.kind() === 'import_statement');
  const edits: Edit[] = [];
  const needed = new Set<string>();
  const handled = new Set<number>();

  const readSite = (call: Node, rewrite: () => void) => {
    const [buffer, options] = argumentsOf(call);
    const problem =
      !buffer ? 'readFile has no buffer'
      : optionsProblem(options)
      ?? (!esm ? 'the file is CommonJS, and the eventStream subpath is ES modules only' : null)
      ?? (!canAwait(call, esm) ? 'the function is not async' : null);
    if (problem) {
      manual.increment(site(root, `readFile: ${problem}`, call));
      return;
    }
    rewrite();
    if (/PixelData|\b(IS|DS)\b/.test(text)) {
      review.increment(
        site(root, 'readFile to the event stream: compressed PixelData without an offset table gives fragments, not frames', call)
      );
    }
  };

  const fromPart10 = (call: Node) => {
    const args = argumentsOf(call).map((arg) => arg.text()).join(', ');
    return `DicomEventStream.fromPart10(${args})`;
  };

  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    if (!calls(call, 'DicomMessage.readFile') || handled.has(call.id())) continue;
    const parent = call.parent();

    // naturalizeDataset(DicomMessage.readFile(buffer).dict)
    const member = parent?.kind() === 'member_expression' ? parent : null;
    const outer = member?.parent()?.parent();
    if (member?.field('property')?.text() === 'dict' && naturalizedField(outer, 'dict')) {
      readSite(call, () => {
        edits.push(outer!.replace(`await ${fromPart10(call)}.toNaturalized()`));
        needed.add('DicomEventStream');
      });
      continue;
    }

    // const D = readFile(buffer); const N = naturalizeDataset(D.dict); [const M = naturalizeDataset(D.meta);]
    const statement = statementOf(call);
    const read = declaration(statement);
    if (!read || read.value.id() !== call.id()) continue;
    const next = [statement!.next(), statement!.next()?.next()].map(declaration);
    let dict = null;
    let meta = null;
    for (const candidate of next) {
      if (!candidate) break;
      if (!dict && naturalizedField(candidate.value, 'dict')?.text() === read.name) dict = candidate;
      else if (!meta && naturalizedField(candidate.value, 'meta')?.text() === read.name) meta = candidate;
      else break;
    }
    if (!dict) continue;
    const used = 1 + 1 + (meta ? 1 : 0);
    if (uses(scopeOf(call), read.name) !== used) {
      manual.increment(site(root, `readFile: ${read.name} has other uses, move them to the naturalized dataset first`, call));
      continue;
    }
    readSite(call, () => {
      const last = meta ? statement!.next()!.next()! : statement!.next()!;
      if (meta) {
        const start = statement!.range().start.index;
        const indent = text.slice(text.lastIndexOf('\n', start - 1) + 1, start);
        edits.push(
          statement!.replace(
            `${read.keyword} ${read.name} = await ${fromPart10(call)}.process(new NaturalizedListener());\n` +
            `${indent}${dict!.keyword} ${dict!.name} = ${read.name}.result;\n` +
            `${indent}${meta.keyword} ${meta.name} = ${read.name}.meta;`
          )
        );
        needed.add('NaturalizedListener');
      } else {
        edits.push(statement!.replace(`${dict!.keyword} ${dict!.name} = await ${fromPart10(call)}.toNaturalized();`));
      }
      needed.add('DicomEventStream');
      edits.push(removeAfter(statement!, last));
    });
  }

  // const D = new DicomDict(denaturalizeDataset(M)); D.dict = denaturalizeDataset(N); const B = D.write(O);
  for (const created of rootNode.findAll({ rule: { kind: 'new_expression' } })) {
    const constructor = created.field('constructor')?.text() ?? '';
    if (!/(^|\.)DicomDict$/.test(constructor)) continue;
    const statement = statementOf(created);
    const holder = declaration(statement);
    if (!holder || holder.value.id() !== created.id()) continue;
    const meta = denaturalized(argumentsOf(created)[0]);
    const assign = statement!.next();
    const assignment = assign?.kind() === 'expression_statement' ? assign.child(0) : null;
    const dataset =
      assignment?.kind() === 'assignment_expression' &&
      assignment.field('left')?.text() === `${holder.name}.dict`
        ? denaturalized(assignment.field('right'))
        : null;
    const writeStatement = assign?.next();
    const write = writeStatement?.find({ rule: { kind: 'call_expression', pattern: `${holder.name}.write($$$ARGS)` } });
    if (!meta || !dataset || !write || statementOf(write)?.id() !== writeStatement?.id()) {
      manual.increment(site(root, 'new DicomDict: the meta, the dict and the write are not three adjacent statements', created));
      continue;
    }
    const problem =
      uses(scopeOf(created), holder.name) !== 3 ? `${holder.name} has other uses`
      : !esm ? 'the file is CommonJS, and the eventStream subpath is ES modules only'
      : !canAwait(created, esm) ? 'the function is not async'
      : null;
    if (problem) {
      manual.increment(site(root, `new DicomDict: ${problem}`, created));
      continue;
    }
    const options = argumentsOf(write).map((arg) => arg.text()).join(', ');
    edits.push(statement!.replace(`${dataset}._meta = ${meta};`));
    edits.push(removeAfter(statement!, assign!));
    edits.push(write.replace(`await DicomEventStream.fromNaturalized(${dataset}).toPart10(${options})`));
    needed.add('DicomEventStream');
  }

  if (!edits.length) return null;
  edits.push(importEdit(rootNode, needed));
  return rootNode.commitEdits(edits.filter(Boolean));
};

/** Removes the text after `kept` up to the end of `last`, with the line breaks. */
function removeAfter(kept: Node, last: Node): Edit {
  return { startPos: kept.range().end.index, endPos: last.range().end.index, insertedText: '' };
}

/** Adds the names to the import of the subpath, or a new import after the last import. */
function importEdit(rootNode: Node, needed: Set<string>): Edit | null {
  const imports = rootNode.children().filter((child) => child.kind() === 'import_statement');
  const existing = imports.find((statement) => statement.field('source')?.text().slice(1, -1) === SUBPATH);
  if (existing) {
    const present = new Set(
      existing.findAll({ rule: { kind: 'import_specifier' } }).map((spec) => spec.field('name')?.text())
    );
    const names = [...present, ...[...needed].filter((name) => !present.has(name))];
    return existing.replace(`import { ${names.join(', ')} } from "${SUBPATH}";`);
  }
  const last = imports[imports.length - 1];
  const insertedText = `\nimport { ${[...needed].sort().join(', ')} } from "${SUBPATH}";`;
  const at = last.range().end.index;
  return { startPos: at, endPos: at, insertedText };
}

export default codemod;

import type { Codemod, Edit, SgNode } from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import { useMetricAtom } from 'codemod:metrics';
import { LIST_VM, PERSON_NAME } from './keywords.ts';

type Node = SgNode<TSX>;

/** Sites that the codemod did not change. A person must change them. */
const manual = useMetricAtom('dcmjs-1-manual');

/** Sites where 1.0 changes what the code does. A person must decide. */
const review = useMetricAtom('dcmjs-1-review');

/** The array methods that read, and give the same result on a copy. */
const READ_METHODS = new Set([
  'forEach', 'map', 'filter', 'find', 'findIndex', 'findLast',
  'findLastIndex', 'some', 'every', 'reduce', 'reduceRight', 'slice',
  'concat', 'indexOf', 'lastIndexOf', 'includes', 'flatMap', 'flat', 'join',
  'entries', 'keys', 'values', 'at',
]);

/** The array methods that change the array. A copy loses the change. */
const WRITE_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill',
  'copyWithin',
]);

/** The methods that only a string has. */
const STRING_METHODS = new Set([
  'split', 'trim', 'trimStart', 'trimEnd', 'toUpperCase', 'toLowerCase',
  'startsWith', 'endsWith', 'replace', 'replaceAll', 'match', 'matchAll',
  'padStart', 'padEnd', 'substring', 'substr', 'charAt', 'charCodeAt',
  'localeCompare', 'normalize', 'search',
]);

const EQUALITY = new Set(['===', '!==', '==', '!=']);
const SCALAR_OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**', '<', '>', '<=', '>=', ...EQUALITY,
]);
const SCALAR_CALLS = new Set([
  'Number', 'parseFloat', 'parseInt', 'isNaN', 'isFinite',
  'Number.parseFloat', 'Number.parseInt', 'Number.isFinite',
]);

function site(root, rule: string, node: Node) {
  return {
    rule,
    file: root.relativeFilename?.() || root.filename(),
    line: String(node.range().start.line + 1),
  };
}

/** The keyword of `object.Keyword`, without optional chaining, or null. */
function keywordOf(node: Node | null): string | null {
  if (node?.kind() !== 'member_expression') return null;
  if (node.children().some((child) => child.kind() === 'optional_chain')) {
    return null;
  }
  const property = node.field('property');
  return property?.kind() === 'property_identifier' ? property.text() : null;
}

function isSequence(keyword: string | null): boolean {
  return !!keyword && keyword.endsWith('Sequence');
}

/** True for a string literal or a template string. */
function isText(node: Node | null): boolean {
  return node?.kind() === 'string' || node?.kind() === 'template_string';
}

/** The method call of `receiver.method(...)` that has `node` as receiver. */
function methodCallOn(node: Node) {
  const member = node.parent();
  if (member?.kind() !== 'member_expression') return null;
  if (member.field('object')?.id() !== node.id()) return null;
  const call = member.parent();
  if (call?.kind() !== 'call_expression') return null;
  if (call.field('function')?.id() !== member.id()) return null;
  return { method: member.field('property')?.text() ?? '', member, call };
}

/** True when the file uses dcmjs: an import of it or a naturalize call. */
function usesDcmjs(rootNode: Node): boolean {
  const text = rootNode.text();
  return (
    /['"](@dcmjs-org\/[\w-]+|dcmjs)(\/[\w./-]*)?['"]/.test(text) ||
    /\b(naturalizeDataset|toNaturalized)\b/.test(text)
  );
}

/** A value that the code uses as one number or one string. */
function scalarUse(node: Node): boolean {
  const parent = node.parent();
  if (!parent) return false;
  const kind = parent.kind();
  if (kind === 'template_substitution') return true;
  if (kind === 'unary_expression') {
    return ['-', '+'].includes(parent.field('operator')?.text() ?? '');
  }
  if (kind === 'binary_expression') {
    const operator = parent.field('operator')?.text() ?? '';
    if (!SCALAR_OPERATORS.has(operator)) return false;
    if (!EQUALITY.has(operator)) return true;
    const other =
      parent.field('left')?.id() === node.id()
        ? parent.field('right')
        : parent.field('left');
    return isText(other) || other?.kind() === 'number';
  }
  if (kind === 'arguments') {
    const callee = parent.parent()?.field('function')?.text() ?? '';
    return SCALAR_CALLS.has(callee) || callee.startsWith('Math.');
  }
  const call = methodCallOn(node);
  return !!call && STRING_METHODS.has(call.method);
}

const codemod: Codemod<TSX> = (root) => {
  const rootNode = root.root();
  const edits: Edit[] = [];
  const dcmjsFile = usesDcmjs(rootNode);

  for (const member of rootNode.findAll({ rule: { kind: 'member_expression' } })) {
    const keyword = keywordOf(member);
    if (!keyword) continue;
    const call = methodCallOn(member);

    // 2.3: a sequence with one item is the item object, not an array
    if (isSequence(keyword) && call) {
      const optional = call.member
        .children()
        .some((child) => child.kind() === 'optional_chain');
      if (optional && READ_METHODS.has(call.method)) {
        manual.increment(
          site(root, `${keyword}?.${call.method}: a sequence with one item is not an array, use Array.from`, member)
        );
      } else if (READ_METHODS.has(call.method)) {
        edits.push(member.replace(`Array.from(${member.text()})`));
      } else if (WRITE_METHODS.has(call.method)) {
        manual.increment(
          site(root, `${keyword}.${call.method}: a sequence with one item is not an array, assign a new list`, member)
        );
      }
      continue;
    }

    // 2.4: a single PN value is the component object
    if (PERSON_NAME.has(keyword)) {
      const parent = member.parent();
      const comparesText =
        parent?.kind() === 'binary_expression' &&
        EQUALITY.has(parent.field('operator')?.text() ?? '') &&
        [parent.field('left'), parent.field('right')].some(isText);
      if (comparesText || (call && STRING_METHODS.has(call.method))) {
        edits.push(member.replace(`String(${member.text()})`));
      } else if (parent?.kind() === 'unary_expression' && parent.text().startsWith('typeof')) {
        manual.increment(
          site(root, `typeof ${keyword}: a PN value is an object, use String(${keyword})`, member)
        );
      }
      continue;
    }

    // 2.1: a list VM keeps the list for one value
    if (dcmjsFile && LIST_VM.has(keyword) && scalarUse(member)) {
      manual.increment(
        site(root, `${keyword}: a list VM keeps the list for one value, take the first value`, member)
      );
    }
  }

  for (const call of rootNode.findAll({ rule: { kind: 'call_expression' } })) {
    const callee = call.field('function')?.text() ?? '';
    const args = call.field('arguments');
    const first = args?.child(1);

    // 2.6: addTagAccessors is a no-op that returns its argument
    if (/(^|\.)ValueRepresentation\.addTagAccessors$/.test(callee) && first) {
      const statement = call.parent();
      edits.push(
        statement?.kind() === 'expression_statement'
          ? statement.replace('')
          : call.replace(first.text())
      );
      continue;
    }

    if (callee === 'Array.isArray' && first) {
      const keyword = keywordOf(first);
      if (isSequence(keyword) || PERSON_NAME.has(keyword ?? '')) {
        manual.increment(
          site(root, `Array.isArray(${keyword}): a single item is not an array in 1.0, use Array.from`, call)
        );
      }
    }

    // 2.5: _vrMap holds new entries, and an object for each private block
    if (/^Object\.(keys|values|entries)$/.test(callee) && keywordOf(first) === '_vrMap') {
      review.increment(
        site(root, `${callee}(_vrMap): _vrMap has hex-tag keys and an object for each private block`, call)
      );
    }

    // 2.5: private elements survive the round trip
    if (dcmjsFile && /(^|\.)denaturalizeDataset$/.test(callee)) {
      review.increment(
        site(root, 'denaturalizeDataset: private elements are kept, remove them where the output must not hold them', call)
      );
    }
  }

  for (const loop of rootNode.findAll({ rule: { kind: 'for_in_statement' } })) {
    if (keywordOf(loop.field('right')) === '_vrMap' && loop.text().includes(' in ')) {
      review.increment(
        site(root, 'for...in _vrMap: _vrMap has hex-tag keys and an object for each private block', loop)
      );
    }
  }

  for (const assignment of rootNode.findAll({ rule: { kind: 'assignment_expression' } })) {
    const left = assignment.field('left');
    const target = left?.text() ?? '';
    // 2.6: registerTag() keywords denaturalize without this write
    if (/(^|\.)nameMap(\[|\.)/.test(target)) {
      manual.increment(
        site(root, 'nameMap write: 1.0 denaturalizes registerTag() keywords, remove the write', assignment)
      );
      continue;
    }
    // 2.5: the hex alias of a private creator is read-only
    const key = left?.kind() === 'subscript_expression' ? left.field('index') : null;
    const hex = key?.kind() === 'string' ? key.text().slice(1, -1) : '';
    if (/^[0-9A-Fa-f]{3}[13579BDFbdf]00[1-9A-Fa-f][0-9A-Fa-f]$/.test(hex)) {
      manual.increment(
        site(root, `${hex}: the alias of a private creator is read-only, change the block key`, assignment)
      );
    }
  }

  // 2.5: the hex keys of block elements are not enumerable
  for (const regex of rootNode.findAll({ rule: { kind: 'regex' } })) {
    const pattern = regex.text();
    if (/\{8\}/.test(pattern) && /0-9a-f|0-9A-F|\\da-f|\[0-9A-Fa-f\]/i.test(pattern)) {
      review.increment(
        site(root, 'a hex-tag pattern: private block elements are under the block key, their hex keys are not enumerable', regex)
      );
    }
  }

  return edits.length ? rootNode.commitEdits(edits) : null;
};

export default codemod;

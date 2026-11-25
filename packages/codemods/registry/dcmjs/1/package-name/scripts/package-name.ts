import type { Codemod, Edit, SgNode } from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import { useMetricAtom } from 'codemod:metrics';

/** Sites that a person must change. */
const manual = useMetricAtom('dcmjs-1-manual');

const NEW_NAME = '@dcmjs-org/dcmjs';

/** The calls whose first argument is a module name. */
const MODULE_CALLS = new Set([
  'require',
  'import',
  'require.resolve',
  'jest.mock',
  'jest.doMock',
  'jest.unmock',
  'jest.requireActual',
  'jest.requireMock',
  'vi.mock',
  'vi.doMock',
  'vi.importActual',
]);

/** The parents whose string is a module name. */
const MODULE_PARENTS = new Set([
  'import_statement',
  'export_statement',
  'import_require_clause',
  'module',
]);

function site(root, rule: string, node: SgNode<TSX>) {
  return {
    rule,
    file: root.relativeFilename?.() || root.filename(),
    line: String(node.range().start.line + 1),
  };
}

/** True when the string is the module name of an import, an export or a call. */
function isModuleName(node: SgNode<TSX>): boolean {
  const parent = node.parent();
  if (!parent) return false;
  if (MODULE_PARENTS.has(parent.kind())) return true;
  // import("dcmjs") in a type
  if (parent.kind() === 'literal_type') return isModuleName(parent);
  if (parent.kind() === 'import') return true;
  if (parent.kind() !== 'arguments') return false;
  if (parent.child(1)?.id() !== node.id()) return false;
  const call = parent.parent();
  const callee = call?.field('function');
  return !!callee && MODULE_CALLS.has(callee.text());
}

const codemod: Codemod<TSX> = (root) => {
  const rootNode = root.root();
  const edits: Edit[] = [];

  for (const node of rootNode.findAll({ rule: { kind: 'string' } })) {
    const text = node.text();
    const quote = text[0];
    const value = text.slice(1, -1);

    if (value === 'dcmjs' && isModuleName(node)) {
      edits.push(node.replace(`${quote}${NEW_NAME}${quote}`));
    } else if (value.startsWith('dcmjs/') && isModuleName(node)) {
      manual.increment(
        site(root, `${value}: 1.0 has no such subpath, import ${NEW_NAME}`, node)
      );
    } else if (/(^\^|\/)dcmjs(\$|\/|$)/.test(value.replaceAll(NEW_NAME, ''))) {
      // a jest moduleNameMapper key or a path into node_modules/dcmjs
      manual.increment(
        site(root, `"${value}": a configuration names the 0.x package`, node)
      );
    }
  }

  return edits.length ? rootNode.commitEdits(edits) : null;
};

export default codemod;

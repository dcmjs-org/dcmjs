import type { Codemod, Edit } from 'codemod:ast-grep';

/** The version range of the new dependency. Change it to install a beta. */
const VERSION = '^1.0.0';

const DEPENDENCY_FIELDS = new Set([
  '"dependencies"',
  '"devDependencies"',
  '"peerDependencies"',
  '"optionalDependencies"',
]);

/** Replaces the dependency on dcmjs 0.x with @dcmjs-org/dcmjs. */
const codemod: Codemod<any> = (root) => {
  const rootNode = root.root();
  const edits: Edit[] = [];

  for (const pair of rootNode.findAll({ rule: { kind: 'pair' } })) {
    if (pair.field('key')?.text() !== '"dcmjs"') continue;
    const field = pair.parent()?.parent();
    if (field?.kind() !== 'pair') continue;
    if (!DEPENDENCY_FIELDS.has(field.field('key')?.text() ?? '')) continue;
    edits.push(pair.replace(`"@dcmjs-org/dcmjs": "${VERSION}"`));
  }

  return edits.length ? rootNode.commitEdits(edits) : null;
};

export default codemod;

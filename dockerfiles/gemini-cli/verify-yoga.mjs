import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const packageRoot = process.argv[2];
if (!packageRoot) {
  throw new Error('Gemini CLI package path is required');
}

const require = createRequire(import.meta.url);
const yogaEntry = require.resolve('yoga-layout', { paths: [packageRoot] });
const { default: Yoga } = await import(pathToFileURL(yogaEntry));

const root = Yoga.Node.create();
const child = Yoga.Node.create();

root.setWidth(42);
root.setHeight(24);
child.setFlexGrow(1);
root.insertChild(child, 0);
root.calculateLayout();

const result = {
  architecture: process.arch,
  rootWidth: root.getComputedWidth(),
  rootHeight: root.getComputedHeight(),
  childWidth: child.getComputedWidth(),
  childHeight: child.getComputedHeight(),
};

root.freeRecursive();

if (
  result.rootWidth !== 42 ||
  result.rootHeight !== 24 ||
  result.childWidth !== 42 ||
  result.childHeight !== 24
) {
  throw new Error(`Yoga layout smoke test failed: ${JSON.stringify(result)}`);
}

console.log(`yoga-layout-ok ${JSON.stringify(result)}`);

import { parse } from 'parse5';

// Use ESLint's public processor interface so inline scripts get the same rules
// as JS modules. Locations map back to the original HTML, including same-line code.
const locations = new Map();
export default {
  meta: { name: 'cayana-html-scripts', version: '1.0.0' },
  preprocess(source, filename) {
    const scripts = [], offsets = [];
    function visit(node) {
      if (node.tagName === 'script' && !node.attrs.some(attr => attr.name === 'src')) {
        const type = node.attrs.find(attr => attr.name === 'type')?.value || '';
        if (['', 'module', 'text/javascript', 'application/javascript'].includes(type)) {
          const start = node.sourceCodeLocation?.startTag, end = node.sourceCodeLocation?.endTag;
          if (start && end) {
            offsets.push({ line: start.endLine - 1, column: start.endCol - 1 });
            scripts.push({ text: source.slice(start.endOffset, end.startOffset), filename: `script-${scripts.length}.js` });
          }
        }
      }
      for (const child of node.childNodes || []) visit(child);
    }
    visit(parse(source, { sourceCodeLocationInfo: true }));
    locations.set(filename, offsets);
    return scripts;
  },
  postprocess(results, filename) {
    const offsets = locations.get(filename) || [];
    locations.delete(filename);
    return results.flatMap((messages, index) => messages.map(message => {
      const { line, column } = offsets[index];
      const mapped = { ...message, line: message.line + line,
        column: message.column + (message.line === 1 ? column : 0) };
      if (message.endLine != null) {
        mapped.endLine = message.endLine + line;
        mapped.endColumn = message.endColumn + (message.endLine === 1 ? column : 0);
      }
      // Fix ranges refer to extracted scripts, so only report original positions.
      delete mapped.fix;
      delete mapped.suggestions;
      return mapped;
    }));
  },
  supportsAutofix: false,
};

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { springTool } from '../src/lib/tools.js';

const TOOLS = ['select', 'pencil', 'rect', 'fill', 'eraser', 'eyedropper'];

test('springTool: Option held with no drag is the eyedropper; otherwise the chosen tool', () => {
  for (const tool of TOOLS) {
    assert.equal(springTool(tool, false, false), tool, `${tool}: Option up`);
    assert.equal(springTool(tool, false, true), tool, `${tool}: Option up, mid-drag`);
    assert.equal(springTool(tool, true, false), 'eyedropper', `${tool}: Option held`);
    assert.equal(springTool(tool, true, true), tool, `${tool}: a drag keeps its tool`);
  }
});

// The Sprite Editor's spring-loaded eyedropper: while Option is held, a
// primary press samples with any tool.

/**
 * The tool the next primary press uses: the eyedropper while Option is held
 * and no drag is in progress, else `tool`. A drag keeps its own tool.
 * @param {string} tool  the chosen tool
 * @param {boolean} option  Option (Alt) is held
 * @param {boolean} dragging  a stroke, rect or selection drag is in progress
 * @returns {string}
 */
export function springTool(tool, option, dragging) {
  return option && !dragging ? 'eyedropper' : tool;
}

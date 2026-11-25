self.onmessage = async (event) => {
  const { type, query, vector, indexBuffer } = event.data ?? {};
  if (type === 'load-index') {
    const values = new Float32Array(indexBuffer);
    self.postMessage({ type: 'index-loaded', dimensions: values.length });
    return;
  }
  if (type === 'dot-product') {
    const left = new Float32Array(query);
    const right = new Float32Array(vector);
    if (left.length !== right.length) {
      self.postMessage({ type: 'error', message: 'Vector dimensions must match.' });
      return;
    }
    let score = 0;
    for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
    self.postMessage({ type: 'dot-product-result', score });
  }
};

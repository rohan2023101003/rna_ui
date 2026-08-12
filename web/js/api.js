/** Thin wrapper over the local server's JSON API. */

async function request(url, options) {
  const response = await fetch(url, options);
  let payload = null;
  try { payload = await response.json(); } catch { /* non-JSON error page */ }
  if (!response.ok) {
    throw new Error(payload?.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

export const api = {
  datasets: () => request('/api/datasets'),

  network: (datasetId) => request(`/api/datasets/${datasetId}`),

  numbering: (datasetId, algorithm) =>
    request(`/api/datasets/${datasetId}/numbering/${encodeURIComponent(algorithm)}`),

  upload: (payload) => request('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),

  events: (payload) => request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }),
};

/** Read a browser File into the base64 form the upload endpoint expects. */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Extensions the server knows how to do something with. */
const KEEP = new Set(['shp', 'shx', 'dbf', 'prj', 'cpg', 'qmd', 'csv']);

export function relevantFiles(fileList) {
  return Array.from(fileList).filter((file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return KEEP.has(ext);
  });
}

// ForMesh3D Compatibility Bridge for Migrated 3DGenStudio Components
// Points to Next.js routes and FastAPI backend endpoints

export const SERVER_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

// Build a URL to a static asset served from ForMesh3D backend
export function assetUrl(pathOrFilename) {
  if (!pathOrFilename) return '';
  if (pathOrFilename.startsWith('http://') || pathOrFilename.startsWith('https://') || pathOrFilename.startsWith('blob:')) {
    return pathOrFilename;
  }
  return `${SERVER_ORIGIN}/static/${encodeURI(pathOrFilename)}`;
}

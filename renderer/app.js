// Hermes WebUI Renderer
document.addEventListener('DOMContentLoaded', () => {
  const iframe = document.getElementById('webui');
  
  // Handle iframe load errors
  iframe.addEventListener('load', () => {
    console.log('Hermes WebUI loaded successfully');
  });
  
  iframe.addEventListener('error', () => {
    console.error('Failed to load Hermes WebUI');
  });

  // Platform info
  if (window.electronAPI) {
    console.log('Platform:', window.electronAPI.platform);
    console.log('Node:', window.electronAPI.versions.node);
    console.log('Chrome:', window.electronAPI.versions.chrome);
    console.log('Electron:', window.electronAPI.versions.electron);
  }
});
